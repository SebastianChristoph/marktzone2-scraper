"""
Local-dev-only debug helpers. Never expose this in production.
"""
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.scrapers.http_scraper import scrape_first_page_http, scrape_product_http

router = APIRouter(prefix="/debug", tags=["debug"])

# Root of the scraper repo (…/scraper/)
SCRAPER_ROOT = Path(__file__).resolve().parent.parent.parent.parent


# ── Fix with AI ────────────────────────────────────────────────────────────────

class FixRequest(BaseModel):
    context: str
    url: Optional[str] = None
    error_type: str
    error_message: Optional[str] = None
    screenshot_file: Optional[str] = None
    scraper_type: str = "product"
    fix_attempts: int = 1          # 1 = first attempt, 2+ = retry after failed fix


def _build_prompt(req: FixRequest) -> str:
    retry_note = ""
    if req.fix_attempts > 1:
        retry_note = f"""
IMPORTANT — PREVIOUS FIX ATTEMPT FAILED:
This is fix attempt #{req.fix_attempts}. A previous fix was applied but a retry scrape
confirmed the problem still exists. Please try a completely different selector strategy
or check if the field is rendered differently in the raw HTML.
"""

    scraper_file = "http_scraper.py"
    method_hint = {
        "no_price":    "_extract_price()",
        "no_title":    "_extract_title()",
        "no_products": "scrape_first_page_http() product extraction",
        "out_of_stock": "_is_out_of_stock() — the detection might be a false positive",
        "captcha":     "_is_captcha() — the detection might be a false positive",
        "scrape_failed": "the general scrape flow",
    }.get(req.error_type, f"the logic related to '{req.error_type}'")

    return f"""Fix the Amazon HTTP scraper for a '{req.error_type}' failure.
{retry_note}
CONTEXT (ASIN or keyword): {req.context}
SCRAPER TYPE: {req.scraper_type}
URL: {req.url or 'unknown'}
ERROR TYPE: {req.error_type}
ERROR MESSAGE: {req.error_message or 'none'}

YOUR TASK:
1. Read backend/app/scrapers/{scraper_file} — focus on {method_hint}.
2. Use httpx or requests to fetch the live page and inspect the HTML:
   python -c "import httpx; r=httpx.get('{req.url or ''}', follow_redirects=True, timeout=30); print(r.text[:8000])"
3. Find the correct CSS selector or extraction logic for BeautifulSoup.
4. Edit backend/app/scrapers/{scraper_file} to fix the issue.

Working directory is already set to the scraper root. All paths are relative to it.
"""


def _launch_powershell(prompt: str) -> dict:
    if sys.platform != "win32":
        return {"launched": False, "reason": "Only supported on Windows"}

    root_str = str(SCRAPER_ROOT)
    ps_script = f"""Set-Location '{root_str}'
$prompt = @'
{prompt}
'@
claude $prompt
"""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".ps1", delete=False, encoding="utf-8"
    ) as f:
        f.write(ps_script)
        tmp_ps1 = f.name

    subprocess.Popen(
        ["powershell", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", f"& '{tmp_ps1}'"],
        creationflags=subprocess.CREATE_NEW_CONSOLE,
    )
    return {"launched": True}


@router.post("/fix-with-ai")
async def fix_with_ai(req: FixRequest) -> dict:
    return _launch_powershell(_build_prompt(req))


# ── Retry scrape ───────────────────────────────────────────────────────────────

class RetryRequest(BaseModel):
    context: str          # ASIN or keyword
    url: Optional[str] = None
    error_type: str       # what field we're verifying
    scraper_type: str = "product"


class RetryResponse(BaseModel):
    success: bool         # scrape completed without crash
    field_found: bool     # the previously-missing field is now present
    result: Optional[dict] = None
    error: Optional[str] = None


def _field_found(result: dict, error_type: str) -> bool:
    if "error" in result:
        return False
    if error_type == "no_price":
        return result.get("price") is not None
    if error_type == "no_title":
        return result.get("title") is not None
    if error_type in ("out_of_stock", "captcha"):
        return "error" not in result
    return True


@router.post("/retry-scrape", response_model=RetryResponse)
async def retry_scrape(req: RetryRequest) -> RetryResponse:
    try:
        if req.scraper_type == "first_page":
            raw = await scrape_first_page_http(req.context)
            products = raw.get("products", [])
            found = len(products) > 0
            return RetryResponse(
                success=True,
                field_found=found,
                result={"count": len(products), "products": products[:3], "suggestions": raw.get("suggestions", [])},
            )
        else:
            result = await scrape_product_http(req.context)
            if result is None:
                return RetryResponse(success=False, field_found=False, error="scrape returned None")
            found = _field_found(result, req.error_type)
            return RetryResponse(success=True, field_found=found, result=result)
    except Exception as e:
        return RetryResponse(success=False, field_found=False, error=str(e))
