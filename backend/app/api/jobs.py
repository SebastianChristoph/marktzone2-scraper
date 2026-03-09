import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from app.scrapers.first_page_scraper import FirstPageScraper
from app.scrapers.product_scraper import ProductScraper
from app.db.job_store import save_job, load_all_jobs, delete_job, delete_completed_jobs
from app.api.security import require_scraper_secret

router = APIRouter(prefix="/jobs", tags=["jobs"])
logger = logging.getLogger(__name__)

_jobs: dict[str, dict] = {}


def _init_jobs_from_db() -> None:
    """Load persisted jobs into memory on startup."""
    for job in load_all_jobs():
        _jobs[job["job_id"]] = job

# At most 4 concurrent Playwright browser instances across all jobs and phases
_BROWSER_SEM = asyncio.Semaphore(4)


class CreateJobRequest(BaseModel):
    cluster_id: int
    markets: list[str]
    max_asins_per_market: int | None = None


class AsinMarket(BaseModel):
    name: str
    asins: list[str]


class CreateAsinJobRequest(BaseModel):
    cluster_id: int
    markets: list[AsinMarket]


class JobProgress(BaseModel):
    done: int
    total: int


class ProductResult(BaseModel):
    asin: str
    title: str
    price: float
    total_revenue: float
    blm: float
    avg_rating: float
    ratings_count: int
    main_category: str | None
    main_category_rank: int | None
    second_category: str | None
    second_category_rank: int | None
    manufacturer: str | None
    store: str | None
    image_url: str | None
    last_scraped: str


class MarketResult(BaseModel):
    market_name: str
    products: list[ProductResult]
    suggestions: list[str] = []


class JobResponse(BaseModel):
    job_id: str
    cluster_id: int
    status: str   # pending | running | completed | failed
    phase: str    # pending | first_page | asin_details | done
    markets: list[str]
    progress: JobProgress
    errors: list[str]
    created_at: str
    results: list[MarketResult] | None = None


def _get_or_404(job_id: str) -> dict:
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


async def _scrape_first_page(job: dict, market_name: str) -> dict:
    """Phase 1: real first-page scraping. market_name is used as the Amazon keyword."""
    logger.info(f"[Job {job['job_id'][:8]}] Phase 1 — scraping first page for: {market_name}")
    try:
        async with _BROWSER_SEM:
            scraper = FirstPageScraper(headless=True)
            raw = await scraper.scrape(market_name)
    except Exception as e:
        raise RuntimeError(f"First-page scraping failed for '{market_name}': {e}") from e

    job["progress"]["done"] += 1

    products = raw.get("products", [])
    suggestions = raw.get("suggestions", [])

    if not products:
        raise RuntimeError(f"First-page scraping returned no products for '{market_name}'")

    logger.info(f"[Job {job['job_id'][:8]}] Phase 1 done — {len(products)} ASINs, {len(suggestions)} suggestions for: {market_name}")
    return {
        "market_name": market_name,
        "suggestions": suggestions,
        "asins": [{"name": p["asin"], "asin": p["asin"]} for p in products],
    }


async def _scrape_one_product(asin: str) -> dict | None:
    """Scrape a single product page, throttled by the global semaphore."""
    async with _BROWSER_SEM:
        scraper = ProductScraper(headless=True)
        return await scraper.scrape(asin)


async def _scrape_asin_details(job: dict, market_name: str, asins: list[dict]) -> dict:
    """Phase 2: scrape product details one-by-one per market (stability over speed)."""
    logger.info(f"[Job {job['job_id'][:8]}] Phase 2 — scraping {len(asins)} ASINs for: {market_name}")
    now = datetime.now(timezone.utc).isoformat()
    products = []
    asin_errors = []
    asin_durations: list[float] = []

    for item in asins:
        asin = item["asin"]
        t_asin = time.monotonic()
        try:
            result = await _scrape_one_product(asin)
            asin_durations.append(round(time.monotonic() - t_asin, 2))
            if result is None:
                asin_errors.append(f"{asin}: scrape returned None")
                continue
            if "error" in result:
                asin_errors.append(f"{asin}: {result['error']}")
                continue
            products.append({
                "asin": result["asin"],
                "title": result.get("title") or item["name"],
                "price": result.get("price") or 0.0,
                "total_revenue": result.get("total_revenue") or 0.0,
                "blm": float(result.get("blm") or 0),
                "avg_rating": result.get("avg_rating") or 0.0,
                "ratings_count": result.get("ratings") or 0,
                "main_category": result.get("main_category"),
                "main_category_rank": result.get("main_category_rank"),
                "second_category": result.get("second_category"),
                "second_category_rank": result.get("second_category_rank"),
                "manufacturer": result.get("manufacturer"),
                "store": result.get("store"),
                "image_url": result.get("img_path"),
                "last_scraped": now,
            })
        except Exception as e:
            asin_durations.append(round(time.monotonic() - t_asin, 2))
            asin_errors.append(f"{asin}: {e}")
            logger.warning(f"[Job {job['job_id'][:8]}] ASIN {asin} failed: {e}")

    job["timing"]["markets"].setdefault(market_name, {})["asin_durations_s"] = asin_durations
    job["progress"]["done"] += 1

    if asin_errors:
        job["errors"].extend([f"Market '{market_name}' — {e}" for e in asin_errors])

    logger.info(
        f"[Job {job['job_id'][:8]}] Phase 2 done — {len(products)}/{len(asins)} products for: {market_name}"
        + (f" ({len(asin_errors)} errors)" if asin_errors else "")
    )
    return {"market_name": market_name, "products": products}


async def _process_job(job_id: str) -> None:
    job = _jobs[job_id]
    job["status"] = "running"
    job_start = time.monotonic()
    job["timing"] = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "markets": {},
    }

    # Phase 1: first-page scraping — all markets in parallel (throttled by semaphore)
    job["phase"] = "first_page"

    async def _timed_phase1(market_name: str):
        t0 = time.monotonic()
        try:
            return await _scrape_first_page(job, market_name)
        finally:
            job["timing"]["markets"].setdefault(market_name, {})["phase1_duration_s"] = round(time.monotonic() - t0, 2)

    raw_first = await asyncio.gather(
        *(_timed_phase1(m) for m in job["markets"]),
        return_exceptions=True,
    )

    first_page = []
    for result in raw_first:
        if isinstance(result, Exception):
            job["errors"].append(str(result))
            job["progress"]["done"] += 1  # skip phase-2 step for failed market
        else:
            first_page.append(result)

    # Phase 2: ASIN detail scraping — markets in parallel, ASINs sequential per market
    job["phase"] = "asin_details"
    limit = job.get("max_asins_per_market")

    async def _timed_phase2(market_name: str, asins: list[dict]):
        t0 = time.monotonic()
        result = await _scrape_asin_details(job, market_name, asins)
        job["timing"]["markets"].setdefault(market_name, {})["phase2_duration_s"] = round(time.monotonic() - t0, 2)
        return result

    if first_page:
        detail_results = await asyncio.gather(
            *(_timed_phase2(r["market_name"], r["asins"][:limit] if limit else r["asins"]) for r in first_page)
        )
        # Merge suggestions from Phase 1 into Phase 2 results
        suggestions_by_market = {r["market_name"]: r.get("suggestions", []) for r in first_page}
        for r in detail_results:
            r["suggestions"] = suggestions_by_market.get(r["market_name"], [])
        job["results"] = [r for r in detail_results if r["products"]]
        for r in detail_results:
            if not r["products"]:
                job["errors"].append(f"Market '{r['market_name']}': no products returned")
    else:
        job["results"] = []

    job["phase"] = "done"
    job["status"] = "failed" if not job["results"] else "completed"
    job["timing"]["completed_at"] = datetime.now(timezone.utc).isoformat()
    job["timing"]["total_duration_s"] = round(time.monotonic() - job_start, 2)
    logger.info(
        f"[Job {job_id[:8]}] Finished — status={job['status']}, "
        f"markets_ok={len(job['results'] or [])}, errors={len(job['errors'])}, "
        f"duration={job['timing']['total_duration_s']}s"
    )
    save_job(job)


async def _process_asin_job(job_id: str, markets: list[AsinMarket]) -> None:
    """ASIN-based clusters: skip first-page scraping, go straight to detail scraping."""
    job = _jobs[job_id]
    job["status"] = "running"
    job["phase"] = "asin_details"
    job_start = time.monotonic()
    job["timing"] = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "markets": {},
    }

    asins_by_market = [
        {"market_name": m.name, "asins": [{"name": a, "asin": a} for a in m.asins]}
        for m in markets
    ]

    async def _timed_phase2(market_name: str, asins: list[dict]):
        t0 = time.monotonic()
        result = await _scrape_asin_details(job, market_name, asins)
        job["timing"]["markets"].setdefault(market_name, {})["phase2_duration_s"] = round(time.monotonic() - t0, 2)
        return result

    detail_results = await asyncio.gather(
        *(_timed_phase2(r["market_name"], r["asins"]) for r in asins_by_market)
    )
    job["results"] = [r for r in detail_results if r["products"]]
    for r in detail_results:
        if not r["products"]:
            job["errors"].append(f"Market '{r['market_name']}': no products returned")

    job["phase"] = "done"
    job["status"] = "failed" if not job["results"] else "completed"
    job["timing"]["completed_at"] = datetime.now(timezone.utc).isoformat()
    job["timing"]["total_duration_s"] = round(time.monotonic() - job_start, 2)
    save_job(job)


def _to_response(job: dict) -> JobResponse:
    results = None
    if job.get("results"):
        results = [MarketResult(**r) for r in job["results"]]
    return JobResponse(
        **{k: v for k, v in job.items() if k not in ("progress", "results", "max_asins_per_market")},
        progress=JobProgress(**job["progress"]),
        results=results,
    )


@router.get("", response_model=list[JobResponse])
async def list_jobs() -> list[JobResponse]:
    return [
        _to_response(j)
        for j in sorted(_jobs.values(), key=lambda j: j["created_at"], reverse=True)
    ]


@router.post("", response_model=JobResponse, status_code=202, dependencies=[Depends(require_scraper_secret)])
async def create_job(request: CreateJobRequest, background_tasks: BackgroundTasks) -> JobResponse:
    job_id = str(uuid.uuid4())
    n = len(request.markets)
    job = {
        "job_id": job_id,
        "cluster_id": request.cluster_id,
        "status": "pending",
        "phase": "pending",
        "markets": request.markets,
        "max_asins_per_market": request.max_asins_per_market,
        "progress": {"done": 0, "total": n * 2},  # 2 phases × n markets
        "errors": [],
        "results": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "timing": {},
    }
    _jobs[job_id] = job
    background_tasks.add_task(_process_job, job_id)
    return _to_response(job)


@router.post("/asin-scrape", response_model=JobResponse, status_code=202, dependencies=[Depends(require_scraper_secret)])
async def create_asin_job(request: CreateAsinJobRequest, background_tasks: BackgroundTasks) -> JobResponse:
    """ASIN-based clusters: skip first-page scraping, go straight to detail scraping."""
    job_id = str(uuid.uuid4())
    n = len(request.markets)
    job = {
        "job_id": job_id,
        "cluster_id": request.cluster_id,
        "status": "pending",
        "phase": "pending",
        "markets": [m.name for m in request.markets],
        "progress": {"done": 0, "total": n},  # only 1 phase
        "errors": [],
        "results": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "timing": {},
    }
    _jobs[job_id] = job
    background_tasks.add_task(_process_asin_job, job_id, request.markets)
    return _to_response(job)


@router.delete("/completed")
async def delete_all_completed() -> dict:
    # Remove from DB
    n = delete_completed_jobs()
    # Remove from memory
    done_ids = [jid for jid, j in list(_jobs.items()) if j["status"] in ("completed", "failed")]
    for jid in done_ids:
        del _jobs[jid]
    return {"deleted": n}


@router.delete("/{job_id}")
async def delete_one_job(job_id: str) -> dict:
    _get_or_404(job_id)
    delete_job(job_id)
    del _jobs[job_id]
    return {"deleted": job_id}


@router.get("/{job_id}", response_model=JobResponse, dependencies=[Depends(require_scraper_secret)])
async def get_job(job_id: str) -> JobResponse:
    return _to_response(_get_or_404(job_id))
