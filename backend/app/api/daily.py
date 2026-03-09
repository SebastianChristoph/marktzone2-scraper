"""
Daily scraper endpoints.
Marktzone controls the flow; this service provides batched scraping workers.
"""
import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.scrapers.first_page_scraper import FirstPageScraper
from app.scrapers.product_scraper import ProductScraper
from app.api.security import require_scraper_secret
from app.db.daily_store import (
    start_session, update_session, complete_session,
    get_current_session, get_running_session, get_history,
)

router = APIRouter(prefix="/daily", tags=["daily"])
logger = logging.getLogger(__name__)

# Shared with jobs.py — 4 concurrent Playwright instances max
_BROWSER_SEM = asyncio.Semaphore(4)

# ── Request / Response models ─────────────────────────────────────────────────

class ScrapeMarketsRequest(BaseModel):
    session_id: str
    markets: list[str]


class ScrapeProductsRequest(BaseModel):
    session_id: str
    asins: list[str]


class CompleteSessionRequest(BaseModel):
    session_id: str
    status: str  # "completed" | "failed"
    products_updated: int = 0
    products_new: int = 0
    markets_changed: int = 0
    markets_done: int = 0
    markets_errors: int = 0
    asins_done: int = 0
    asins_errors: int = 0
    total_duration_s: float = 0.0


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _scrape_market(keyword: str) -> tuple[str, list[str], list[str]]:
    """Scrape first page for a single keyword. Returns (keyword, asins, suggestions)."""
    try:
        async with _BROWSER_SEM:
            scraper = FirstPageScraper(headless=True)
            raw = await scraper.scrape(keyword)
        asins = [p["asin"] for p in raw.get("products", [])]
        suggestions = raw.get("suggestions", [])
        return keyword, asins, suggestions
    except Exception as e:
        logger.warning(f"[Daily] Market scrape failed for '{keyword}': {e}")
        return keyword, [], []


async def _scrape_product(asin: str) -> dict | None:
    """Scrape a single product page. Returns product dict or None on error."""
    try:
        async with _BROWSER_SEM:
            scraper = ProductScraper(headless=True)
            result = await scraper.scrape(asin)
        if result is None or "error" in result:
            return None
        return result
    except Exception as e:
        logger.warning(f"[Daily] Product scrape failed for '{asin}': {e}")
        return None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/session/start", dependencies=[Depends(require_scraper_secret)])
async def start_daily_session() -> dict:
    """Start a new daily session. Returns 409 if one is already running."""
    try:
        session_id = start_session()
        logger.info(f"[Daily] Session started: {session_id}")
        return {"session_id": session_id}
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/scrape-markets", dependencies=[Depends(require_scraper_secret)])
async def scrape_markets(req: ScrapeMarketsRequest) -> dict:
    """
    Scrape first-page results for a batch of market keywords.
    All markets in the batch are scraped in parallel (throttled by Semaphore(4)).
    Never raises — failed markets return empty ASIN lists.
    """
    logger.info(f"[Daily] Scraping {len(req.markets)} markets for session {req.session_id[:8]}")

    tasks = [_scrape_market(kw) for kw in req.markets]
    results_raw = await asyncio.gather(*tasks)

    results = {}
    errors = 0
    for keyword, asins, suggestions in results_raw:
        results[keyword] = {"asins": asins, "suggestions": suggestions}
        if not asins:
            errors += 1

    done_so_far = len(req.markets)
    try:
        session = get_current_session()
        if session:
            update_session(
                req.session_id,
                markets_done=session.get("markets_done", 0) + done_so_far,
                markets_errors=session.get("markets_errors", 0) + errors,
            )
    except Exception:
        pass  # stats update failure must not break scraping

    logger.info(f"[Daily] Markets done: {done_so_far}, errors: {errors}")
    return {"results": results}


@router.post("/scrape-products", dependencies=[Depends(require_scraper_secret)])
async def scrape_products(req: ScrapeProductsRequest) -> dict:
    """
    Scrape product detail pages for a batch of ASINs.
    All ASINs in the batch are scraped in parallel (throttled by Semaphore(4)).
    Never raises — failed ASINs are omitted from results.
    """
    logger.info(f"[Daily] Scraping {len(req.asins)} ASINs for session {req.session_id[:8]}")

    tasks = [_scrape_product(asin) for asin in req.asins]
    raw_results = await asyncio.gather(*tasks)

    results = [r for r in raw_results if r is not None]
    errors = len(req.asins) - len(results)

    try:
        session = get_current_session()
        if session:
            update_session(
                req.session_id,
                asins_done=session.get("asins_done", 0) + len(req.asins),
                asins_errors=session.get("asins_errors", 0) + errors,
            )
    except Exception:
        pass

    logger.info(f"[Daily] Products done: {len(results)}/{len(req.asins)}, errors: {errors}")
    return {"results": results}


@router.post("/session/complete", dependencies=[Depends(require_scraper_secret)])
async def finish_daily_session(req: CompleteSessionRequest) -> dict:
    """Finalize the daily session with final stats."""
    complete_session(
        req.session_id,
        status=req.status,
        total_duration_s=req.total_duration_s,
        products_updated=req.products_updated,
        products_new=req.products_new,
        markets_changed=req.markets_changed,
        markets_done=req.markets_done,
        markets_errors=req.markets_errors,
        asins_done=req.asins_done,
        asins_errors=req.asins_errors,
    )
    logger.info(f"[Daily] Session {req.session_id[:8]} completed with status={req.status}")
    return {"ok": True}


@router.post("/session/update-phase", dependencies=[Depends(require_scraper_secret)])
async def update_phase(session_id: str, phase: str, asins_total: int | None = None) -> dict:
    """Update the current phase label and optionally set asins_total."""
    kwargs: dict = {"phase": phase}
    if asins_total is not None:
        kwargs["asins_total"] = asins_total
    update_session(session_id, **kwargs)
    return {"ok": True}


@router.get("/status")
async def daily_status() -> dict:
    """Return the current running session, or the last completed one."""
    session = get_current_session()
    if session is None:
        return {"session": None}
    return {"session": session}


@router.get("/history")
async def daily_history() -> dict:
    """Return the last 30 daily sessions."""
    return {"sessions": get_history(30)}
