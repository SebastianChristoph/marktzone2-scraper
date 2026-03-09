"""
Scraper health monitor — periodic automated test scrapes.
Schedule: every 5 hours (via asyncio background task).
Success criteria:
  - First-page: ≥ 5 ASINs returned
  - Product: title + price + main_category_rank + ratings_count + avg_rating all present
"""
import asyncio
import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

from app.scrapers.first_page_scraper import FirstPageScraper
from app.scrapers.product_scraper import ProductScraper
from app.db.health_store import get_config, set_config, save_check, get_latest_check, get_history

router = APIRouter(prefix="/health-monitor", tags=["health-monitor"])
logger = logging.getLogger(__name__)

_CHECK_INTERVAL_S = 5 * 3600  # 5 hours
_PRODUCT_REQUIRED_FIELDS = ["title", "price", "main_category_rank", "ratings_count", "avg_rating"]
_MIN_FIRST_PAGE_ASINS = 5

_SEM = asyncio.Semaphore(2)  # health checks don't need full 4 slots


# ── Request models ─────────────────────────────────────────────────────────────

class ConfigRequest(BaseModel):
    asins: list[str]
    keywords: list[str]


# ── Core check logic ──────────────────────────────────────────────────────────

async def _check_keyword(keyword: str) -> dict:
    t0 = time.monotonic()
    result = {"keyword": keyword, "ok": False, "asin_count": 0, "duration_s": 0.0, "error": None}
    try:
        async with _SEM:
            scraper = FirstPageScraper(headless=True)
            raw = await scraper.scrape(keyword)
        asins = [p["asin"] for p in raw.get("products", [])]
        result["asin_count"] = len(asins)
        result["ok"] = len(asins) >= _MIN_FIRST_PAGE_ASINS
        result["asins"] = asins[:10]
    except Exception as e:
        result["error"] = str(e)
    result["duration_s"] = round(time.monotonic() - t0, 2)
    return result


async def _check_asin(asin: str) -> dict:
    t0 = time.monotonic()
    result = {"asin": asin, "ok": False, "missing_fields": [], "duration_s": 0.0, "error": None, "data": {}}
    try:
        async with _SEM:
            scraper = ProductScraper(headless=True)
            raw = await scraper.scrape(asin)
        if raw:
            missing = [f for f in _PRODUCT_REQUIRED_FIELDS if not raw.get(f)]
            result["missing_fields"] = missing
            result["ok"] = len(missing) == 0
            result["data"] = {f: raw.get(f) for f in _PRODUCT_REQUIRED_FIELDS}
        else:
            result["missing_fields"] = _PRODUCT_REQUIRED_FIELDS
            result["error"] = "no data returned"
    except Exception as e:
        result["error"] = str(e)
    result["duration_s"] = round(time.monotonic() - t0, 2)
    return result


async def run_health_check() -> dict:
    """Run a full health check and persist the result."""
    cfg = get_config()
    asins = cfg.get("asins", [])
    keywords = cfg.get("keywords", [])

    t0 = time.monotonic()
    logger.info("Health check starting — %d ASINs, %d keywords", len(asins), len(keywords))

    tasks = (
        [_check_keyword(kw) for kw in keywords] +
        [_check_asin(asin) for asin in asins]
    )
    results = await asyncio.gather(*tasks, return_exceptions=True)

    keyword_results = []
    asin_results = []
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            if i < len(keywords):
                keyword_results.append({"keyword": keywords[i], "ok": False, "error": str(r)})
            else:
                asin_results.append({"asin": asins[i - len(keywords)], "ok": False, "error": str(r)})
        elif i < len(keywords):
            keyword_results.append(r)
        else:
            asin_results.append(r)

    all_ok = all(r.get("ok") for r in keyword_results + asin_results)
    total_duration = round(time.monotonic() - t0, 2)

    details = {
        "keywords": keyword_results,
        "asins": asin_results,
    }

    save_check(all_ok, total_duration, details)
    logger.info("Health check done — ok=%s, duration=%.1fs", all_ok, total_duration)
    return {"ok": all_ok, "duration_s": total_duration, "details": details}


# ── Background scheduler ──────────────────────────────────────────────────────

async def _scheduler():
    """Runs health checks every _CHECK_INTERVAL_S seconds, starting immediately."""
    logger.info("Health monitor scheduler started (interval=%dh)", _CHECK_INTERVAL_S // 3600)
    while True:
        try:
            await run_health_check()
        except Exception as e:
            logger.exception("Health check failed: %s", e)
        await asyncio.sleep(_CHECK_INTERVAL_S)


def start_scheduler():
    asyncio.create_task(_scheduler())


# ── API routes ────────────────────────────────────────────────────────────────

@router.get("/config")
async def get_monitor_config():
    return get_config()


@router.put("/config")
async def update_monitor_config(req: ConfigRequest):
    set_config(req.asins, req.keywords)
    return {"ok": True}


@router.get("/status")
async def get_status():
    latest = get_latest_check()
    return {"check": latest}


@router.get("/history")
async def get_check_history():
    return {"history": get_history(20)}


@router.post("/run")
async def trigger_check():
    """Manually trigger a health check (runs in background)."""
    asyncio.create_task(run_health_check())
    return {"ok": True, "message": "Health check started"}
