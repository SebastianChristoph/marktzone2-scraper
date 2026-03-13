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
from app.scrapers.product_scraper import ProductScraper, DAILY_RETRY_BACKOFFS
from app.scrapers.proxy_manager import check_proxy
from app.api.security import require_scraper_secret
from app.db.error_log import log_error
from app.db.daily_store import (
    start_session, update_session, complete_session,
    get_current_session, get_running_session, get_history, clear_history,
    log_daily_event, get_daily_log,
    mark_session_blocked, is_session_blocked, unblock_session,
)

router = APIRouter(prefix="/daily", tags=["daily"])
logger = logging.getLogger(__name__)

# 1 concurrent Playwright instance — eliminates proxy session collisions entirely
_BROWSER_SEM = asyncio.Semaphore(1)

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


class LogEntryRequest(BaseModel):
    session_id: str
    message: str
    level: str = "info"  # info | warning | error
    phase: str | None = None


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
        log_error(
            scraper_type="first_page",
            context=keyword,
            error_type="exception",
            error_message=str(e),
            url=f"https://www.amazon.com/s?k={keyword.replace(' ', '+')}",
        )
        return keyword, [], []


async def _scrape_product(asin: str) -> tuple[dict | None, str | None]:
    """Scrape a single product page. Returns (result, error_type). error_type is None on success."""
    import random
    # Stagger: wait 1–5s before competing for the semaphore to avoid tunnel collisions
    await asyncio.sleep(random.uniform(1.0, 5.0))
    try:
        async with _BROWSER_SEM:
            scraper = ProductScraper(headless=True, retry_backoffs=DAILY_RETRY_BACKOFFS)
            result = await scraper.scrape(asin)
        if result is None:
            # product_scraper already logged scrape_failed
            return None, "scrape_failed"
        if "error" in result:
            # product_scraper already logged the specific error
            return None, str(result["error"])
        return result, None
    except Exception as e:
        logger.warning(f"[Daily] Product scrape failed for '{asin}': {e}")
        log_error(
            scraper_type="product",
            context=asin,
            error_type="exception",
            error_message=str(e),
            url=f"https://www.amazon.com/dp/{asin}?language=en_US",
        )
        return None, "exception"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/session/start", dependencies=[Depends(require_scraper_secret)])
async def start_daily_session() -> dict:
    """Start a new daily session. Returns 409 if one is already running."""
    try:
        session_id = start_session()
        logger.info(f"[Daily] Session started: {session_id}")
        # #6: Proxy health check before committing to a full run
        proxy_ok = await asyncio.to_thread(check_proxy)
        if proxy_ok:
            log_daily_event(session_id, "Daily Session gestartet — Proxy OK", phase="market_discovery")
        else:
            log_daily_event(session_id,
                "Daily Session gestartet — ⚠️ PROXY HEALTH CHECK FEHLGESCHLAGEN. "
                "Scraping könnte vollständig scheitern!",
                level="warning", phase="market_discovery")
        return {"session_id": session_id, "proxy_ok": proxy_ok}
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
        if asins:
            log_daily_event(req.session_id, f"'{keyword}' → {len(asins)} ASINs", phase="market_discovery")
        else:
            errors += 1
            log_daily_event(req.session_id, f"'{keyword}' → 0 ASINs (Fehler)", level="warning", phase="market_discovery")

    done_so_far = len(req.markets)
    log_daily_event(
        req.session_id,
        f"Märkte-Batch: {done_so_far - errors}/{done_so_far} OK, {errors} Fehler",
        level="info" if errors == 0 else "warning",
        phase="market_discovery",
    )

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
    # Short-circuit: if a previous batch detected a full proxy blockade, reject immediately.
    # This prevents batches from piling up in the asyncio queue when the C# client has
    # already timed out and moved on to the next batch.
    if is_session_blocked(req.session_id):
        log_daily_event(
            req.session_id,
            f"Batch sofort abgelehnt — Session bereits blockiert ({len(req.asins)} ASINs übersprungen).",
            level="warning", phase="product_scraping",
        )
        return {"results": [], "aborted": True}

    logger.info(f"[Daily] Scraping {len(req.asins)} ASINs for session {req.session_id[:8]}")

    tasks = [_scrape_product(asin) for asin in req.asins]
    raw_results = await asyncio.gather(*tasks)

    results: list[dict] = []
    error_map: dict[str, list[str]] = {}  # error_type → list of ASINs
    for (result, error_type), asin in zip(raw_results, req.asins):
        if result is not None:
            results.append(result)
        elif error_type:
            error_map.setdefault(error_type, []).append(asin)

    errors = len(req.asins) - len(results)
    error_rate = errors / len(req.asins) if req.asins else 0

    # Log per-error-type breakdown for post-mortem analysis
    if error_map:
        # Captcha / bot-detection: escalate each ASIN individually
        for asin in error_map.get("captcha", []):
            log_daily_event(
                req.session_id,
                f"CAPTCHA / Bot-Check erkannt: {asin}",
                level="error", phase="product_scraping",
            )
        # scrape_failed: show first 5, then summarize
        sf_asins = error_map.get("scrape_failed", [])
        if sf_asins:
            shown = sf_asins[:5]
            remainder = len(sf_asins) - len(shown)
            log_daily_event(
                req.session_id,
                f"scrape_failed ({len(sf_asins)}x): {', '.join(shown)}"
                + (f" … +{remainder} weitere" if remainder else ""),
                level="warning", phase="product_scraping",
            )
        # exception: show first 5, summarize rest
        ex_asins = error_map.get("exception", [])
        if ex_asins:
            shown = ex_asins[:5]
            remainder = len(ex_asins) - len(shown)
            log_daily_event(
                req.session_id,
                f"exception ({len(ex_asins)}x): {', '.join(shown)}"
                + (f" … +{remainder} weitere" if remainder else ""),
                level="warning", phase="product_scraping",
            )
        # Any other error types
        for err_type, asins in error_map.items():
            if err_type in ("captcha", "scrape_failed", "exception"):
                continue
            shown = asins[:5]
            remainder = len(asins) - len(shown)
            log_daily_event(
                req.session_id,
                f"{err_type} ({len(asins)}x): {', '.join(shown)}"
                + (f" … +{remainder} weitere" if remainder else ""),
                level="warning", phase="product_scraping",
            )

    # #3: Detect proxy blockade — abort if ≥ 70% of batch failed
    aborted = False
    if error_rate >= 1.0:
        mark_session_blocked(req.session_id)
        msg = (f"ASIN-Batch: 0/{len(req.asins)} OK — VOLLSTÄNDIGE BLOCKADE erkannt "
               f"(100% Fehler). Session blockiert, alle weiteren Batches werden sofort abgelehnt.")
        log_daily_event(req.session_id, msg, level="error", phase="product_scraping")
        aborted = True
    elif error_rate >= 0.7:
        msg = (f"ASIN-Batch: {len(results)}/{len(req.asins)} OK — HOHE FEHLERRATE "
               f"({error_rate:.0%}). Mögliche Proxy-Blockade.")
        log_daily_event(req.session_id, msg, level="error", phase="product_scraping")
    else:
        log_daily_event(
            req.session_id,
            f"ASIN-Batch: {len(results)}/{len(req.asins)} OK, {errors} Fehler",
            level="info" if errors == 0 else "warning",
            phase="product_scraping",
        )

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

    logger.info(f"[Daily] Products done: {len(results)}/{len(req.asins)}, errors: {errors}, aborted: {aborted}")
    return {"results": results, "aborted": aborted}


@router.post("/session/complete", dependencies=[Depends(require_scraper_secret)])
async def finish_daily_session(req: CompleteSessionRequest) -> dict:
    """Finalize the daily session with final stats."""
    unblock_session(req.session_id)
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

    dur = req.total_duration_s
    hours = int(dur // 3600)
    mins = int((dur % 3600) // 60)
    dur_str = f"{hours}h {mins}min" if hours else f"{mins}min"
    summary = (
        f"Session abgeschlossen [{req.status.upper()}]: "
        f"{req.products_new} neu, {req.products_updated} aktualisiert, "
        f"{req.markets_changed} Märkte geändert | "
        f"{req.asins_done} ASINs, {req.asins_errors} Fehler | "
        f"Dauer: {dur_str}"
    )
    log_daily_event(
        req.session_id, summary,
        level="info" if req.status == "completed" else "error",
        phase="done",
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

    phase_labels = {
        "market_discovery": "Markt-Discovery",
        "product_scraping": "ASIN-Scraping",
        "aggregation": "Aggregation",
        "finalization": "Finalisierung",
        "done": "Abgeschlossen",
    }
    label = phase_labels.get(phase, phase)
    msg = f"Phase: {label} ({asins_total} ASINs)" if asins_total else f"Phase: {label}"
    log_daily_event(session_id, msg, phase=phase)

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


@router.delete("/history")
async def delete_daily_history() -> dict:
    """Delete all completed/failed daily sessions and their log entries."""
    deleted = clear_history()
    logger.info(f"[Daily] Deleted {deleted} sessions from history")
    return {"ok": True, "deleted": deleted}


@router.get("/log")
async def get_log(session_id: str | None = None, limit: int = 500) -> dict:
    """Return structured log entries for a daily session."""
    return {"entries": get_daily_log(session_id=session_id, limit=limit)}


@router.post("/log", dependencies=[Depends(require_scraper_secret)])
async def push_log_entry(req: LogEntryRequest) -> dict:
    """Allow external callers (e.g. marktzone backend) to push log entries."""
    log_daily_event(req.session_id, req.message, level=req.level, phase=req.phase)
    return {"ok": True}
