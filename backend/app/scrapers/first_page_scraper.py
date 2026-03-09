import asyncio
import logging
import random
import re
import time
from pathlib import Path
from typing import Optional

from playwright.sync_api import sync_playwright, Page

from app.db.error_log import log_error
from app.db.paths import SCREENSHOTS_DIR
from app.scrapers.proxy_manager import get_proxy

logger = logging.getLogger(__name__)

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
]

# Retry backoff in seconds: attempt 1→10s, 2→30s (exponential)
RETRY_BACKOFFS = [10, 30]


class FirstPageScraper:
    def __init__(self, headless: bool = True):
        self.headless = headless

    async def scrape(self, keyword: str, job_id: Optional[str] = None, test_screenshot: bool = False, country: Optional[str] = None) -> dict:
        return await asyncio.to_thread(self._scrape_sync, keyword, job_id, test_screenshot, country)

    def _scrape_sync(self, keyword: str, job_id: Optional[str], test_screenshot: bool = False, country: Optional[str] = None) -> dict:
        max_retries = 3
        for attempt in range(max_retries):
            try:
                result = self._scrape_once_sync(keyword, job_id, attempt + 1, test_screenshot, country)
                if result is not None:
                    result["_debug"] = {**result.get("_debug", {}), "attempts": attempt + 1}
                    return result
                logger.warning(f"[FP] No products on attempt {attempt + 1}")
            except Exception as e:
                logger.error(f"[FP] Attempt {attempt + 1} failed: {e}")
                if attempt == max_retries - 1:
                    log_error(
                        scraper_type="first_page",
                        context=keyword,
                        error_type="scrape_failed",
                        error_message=f"All {max_retries} retries exhausted: {e}",
                        url=f"https://www.amazon.com/s?k={keyword.replace(' ', '+')}",
                        job_id=job_id,
                        attempt=attempt + 1,
                    )
            if attempt < max_retries - 1:
                backoff = RETRY_BACKOFFS[attempt] if attempt < len(RETRY_BACKOFFS) else 60
                logger.info(f"[FP] Waiting {backoff}s before retry...")
                time.sleep(backoff)
        proxy = get_proxy(country)
        return {
            "products": [],
            "suggestions": [],
            "_debug": {
                "proxy": proxy["server"] if proxy else "none (direct)",
                "attempts": max_retries,
                "user_agent": "n/a (all retries failed)",
            },
        }

    def _scrape_once_sync(self, keyword: str, job_id: Optional[str], attempt: int, test_screenshot: bool = False, country: Optional[str] = None) -> Optional[dict]:
        user_agent = random.choice(USER_AGENTS)
        url = f"https://www.amazon.com/s?k={keyword.replace(' ', '+')}"
        proxy = get_proxy(country)
        proxy_server = proxy["server"] if proxy else None
        if proxy:
            logger.info(f"[FP] Using proxy: {proxy_server} (country={country or 'default'})")
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=self.headless,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--window-size=1920,1080",
                    "--disable-blink-features=AutomationControlled",
                    "--disable-infobars",
                    "--disable-extensions",
                ],
            )
            context = browser.new_context(
                user_agent=user_agent,
                viewport={"width": random.choice([1280, 1366, 1440, 1920]), "height": random.choice([768, 900, 1080])},
                locale="en-US",
                extra_http_headers={
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                    "sec-ch-ua-platform": '"Windows"',
                },
                **({"proxy": proxy} if proxy else {}),
            )
            # Hide navigator.webdriver
            context.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                window.chrome = { runtime: {} };
            """)
            try:
                page = context.new_page()

                # Best-effort: visit homepage first to capture autocomplete suggestions
                suggestions = self._get_suggestions_sync(page, keyword)

                logger.info(f"[FP] GET {url}")
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=30000)
                except Exception as goto_err:
                    screenshot = self._take_screenshot(page, keyword, "timeout")
                    log_error(
                        scraper_type="first_page",
                        context=keyword,
                        error_type="timeout",
                        error_message=str(goto_err),
                        url=url,
                        job_id=job_id,
                        attempt=attempt,
                        screenshot_file=screenshot,
                    )
                    raise
                time.sleep(random.uniform(1.0, 2.0))

                if self._is_captcha_sync(page):
                    screenshot = self._take_screenshot(page, keyword, "captcha")
                    log_error(
                        scraper_type="first_page",
                        context=keyword,
                        error_type="captcha",
                        error_message="CAPTCHA or bot check detected",
                        url=url,
                        job_id=job_id,
                        attempt=attempt,
                        screenshot_file=screenshot,
                    )
                    raise RuntimeError("CAPTCHA or bot check detected")

                self._scroll_sync(page)

                ts_filename = None
                if test_screenshot:
                    ts_filename = self._take_test_screenshot(page, keyword)

                asins = self._extract_products_sync(page, keyword, job_id, attempt, url)

                if not asins:
                    screenshot = self._take_screenshot(page, keyword, "no_products")
                    log_error(
                        scraper_type="first_page",
                        context=keyword,
                        error_type="no_products",
                        error_message="No products extracted from search results page",
                        url=url,
                        job_id=job_id,
                        attempt=attempt,
                        screenshot_file=screenshot,
                    )
                    return None

                logger.info(f"[FP] Extracted {len(asins)} ASINs, {len(suggestions)} suggestions for '{keyword}'")
                result: dict = {
                    "products": asins,
                    "suggestions": suggestions,
                    "_debug": {
                        "proxy": proxy_server or "none (direct)",
                        "user_agent": user_agent,
                        "attempt": attempt,
                    },
                }
                if ts_filename:
                    result["test_screenshot"] = ts_filename
                return result
            finally:
                context.close()
                browser.close()

    def _get_suggestions_sync(self, page: Page, keyword: str) -> list[str]:
        """Best-effort: navigate to Amazon homepage, type keyword, capture autocomplete suggestions."""
        try:
            page.goto("https://www.amazon.com/", wait_until="domcontentloaded", timeout=20000)
            time.sleep(random.uniform(1.5, 2.5))

            # Dismiss "ship to Germany" or similar overlay if present
            try:
                dismiss = page.query_selector("input[data-action-type='DISMISS']")
                if not dismiss:
                    dismiss = page.query_selector("button:has-text('Dismiss')")
                if dismiss:
                    dismiss.click()
                    time.sleep(0.5)
            except Exception:
                pass

            # Try multiple selectors for the search box (same strategy as old scraper)
            search_box = None
            for sel in [
                "input[role='searchbox']",
                "#twotabsearchtextbox",
                "input#twotabsearchtextbox",
                "input[type='text']",
            ]:
                try:
                    el = page.query_selector(sel)
                    if el and el.is_visible():
                        search_box = el
                        break
                except Exception:
                    continue

            if not search_box:
                logger.warning("[FP] Suggestions: search box not found on homepage")
                return []

            search_box.click()
            time.sleep(0.5)
            search_box.type(keyword, delay=100)

            # Wait 3–5 seconds for autocomplete to fully populate (same as old scraper)
            time.sleep(random.uniform(3.0, 5.0))

            try:
                page.wait_for_selector("#sac-autocomplete-results-container", timeout=8000)
            except Exception:
                logger.warning("[FP] Suggestions: autocomplete container not visible")
                return []

            # Get full container text and split by newline — same approach as old scraper
            container = page.query_selector("#sac-autocomplete-results-container")
            if not container:
                return []

            raw_text = container.inner_text()
            keyword_lower = keyword.lower()
            suggestions = [
                line.strip()
                for line in raw_text.split("\n")
                if line.strip() and keyword_lower in line.strip().lower()
            ]

            logger.info(f"[FP] Captured {len(suggestions)} suggestions for '{keyword}'")
            return suggestions[:10]

        except Exception as e:
            logger.warning(f"[FP] Suggestions step failed (continuing without): {e}")
            return []

    def _is_captcha_sync(self, page: Page) -> bool:
        try:
            title = page.title().lower()
            if "captcha" in title or "robot" in title:
                return True
            content = page.content()
            if "Type the characters you see in this image" in content or "Enter the characters you see below" in content:
                return True
            # Amazon "Sorry, something went wrong" dog page = soft block
            if "something went wrong on our end" in content or "Meet the dogs of Amazon" in content:
                return True
            return False
        except Exception:
            return False

    def _scroll_sync(self, page: Page):
        for _ in range(3):
            page.evaluate("window.scrollBy(0, window.innerHeight)")
            time.sleep(random.uniform(0.4, 0.8))
        page.evaluate("window.scrollTo(0, 0)")
        time.sleep(0.3)

    def _extract_products_sync(
        self, page: Page, keyword: str, job_id: Optional[str], attempt: int, url: str
    ) -> list[dict]:
        try:
            page.wait_for_selector("[data-asin]", timeout=10000)
        except Exception:
            logger.warning("[FP] Timeout waiting for [data-asin] elements")
            screenshot = self._take_screenshot(page, keyword, "no_products")
            log_error(
                scraper_type="first_page",
                context=keyword,
                error_type="no_products",
                error_message="Timeout waiting for [data-asin] elements",
                url=url,
                job_id=job_id,
                attempt=attempt,
                screenshot_file=screenshot,
            )
            return []

        items = page.query_selector_all("[data-asin]")
        asins = []
        seen: set[str] = set()

        for item in items:
            asin = item.get_attribute("data-asin")
            if not asin or asin in seen:
                continue
            seen.add(asin)
            asins.append({"asin": asin})

        return asins

    def _take_test_screenshot(self, page: Page, keyword: str) -> Optional[str]:
        try:
            from datetime import datetime, timezone
            ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            safe_kw = re.sub(r"[^\w\-]", "_", keyword)[:40]
            filename = f"test_fp_{safe_kw}_{ts}.png"
            page.screenshot(path=str(SCREENSHOTS_DIR / filename), full_page=False)
            logger.info(f"[FP] Test screenshot saved: {filename}")
            return filename
        except Exception as e:
            logger.warning(f"[FP] Test screenshot failed: {e}")
            return None

    def _take_screenshot(self, page: Page, context: str, error_type: str) -> Optional[str]:
        try:
            from datetime import datetime, timezone
            ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            safe_ctx = re.sub(r"[^\w\-]", "_", context)[:40]
            filename = f"{ts}_{safe_ctx}_{error_type}.png"
            page.screenshot(path=str(SCREENSHOTS_DIR / filename), full_page=False)
            return filename
        except Exception as e:
            logger.warning(f"[FP] Screenshot failed: {e}")
            return None
