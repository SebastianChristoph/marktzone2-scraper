import asyncio
import logging
import random
import re
import time
from pathlib import Path
from typing import Optional

from playwright.sync_api import sync_playwright, Page, ElementHandle

from app.db.error_log import log_error
from app.db.paths import SCREENSHOTS_DIR

logger = logging.getLogger(__name__)

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
]

RETRY_BACKOFFS = [10, 30]


class ProductScraper:
    def __init__(self, headless: bool = True):
        self.headless = headless

    async def scrape(self, asin: str, job_id: Optional[str] = None) -> Optional[dict]:
        return await asyncio.to_thread(self._scrape_sync, asin, job_id)

    def _scrape_sync(self, asin: str, job_id: Optional[str]) -> Optional[dict]:
        max_retries = 3
        for attempt in range(max_retries):
            try:
                result = self._scrape_once_sync(asin, job_id, attempt + 1)
                if result:
                    return result
                logger.warning(f"[PS] No data on attempt {attempt + 1} for {asin}")
            except Exception as e:
                logger.error(f"[PS] Attempt {attempt + 1} failed for {asin}: {e}")
                if attempt == max_retries - 1:
                    log_error(
                        scraper_type="product",
                        context=asin,
                        error_type="scrape_failed",
                        error_message=f"All {max_retries} retries exhausted: {e}",
                        url=f"https://www.amazon.com/dp/{asin}?language=en_US",
                        job_id=job_id,
                        attempt=attempt + 1,
                    )
            if attempt < max_retries - 1:
                backoff = RETRY_BACKOFFS[attempt] if attempt < len(RETRY_BACKOFFS) else 60
                logger.info(f"[PS] Waiting {backoff}s before retry...")
                time.sleep(backoff)
        return None

    def _scrape_once_sync(self, asin: str, job_id: Optional[str], attempt: int) -> Optional[dict]:
        user_agent = random.choice(USER_AGENTS)
        url = f"https://www.amazon.com/dp/{asin}?language=en_US"

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
                ],
            )
            context = browser.new_context(
                user_agent=user_agent,
                viewport={"width": random.choice([1280, 1366, 1440, 1920]), "height": random.choice([768, 900, 1080])},
                locale="en-US",
                extra_http_headers={
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                },
            )
            context.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                window.chrome = { runtime: {} };
            """)
            try:
                page = context.new_page()
                logger.info(f"[PS] GET {url}")
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
                time.sleep(random.uniform(1.0, 2.0))

                self._handle_continue_shopping(page)

                if self._is_captcha(page):
                    screenshot = self._take_screenshot(page, asin, "captcha")
                    log_error(
                        scraper_type="product",
                        context=asin,
                        error_type="captcha",
                        error_message="CAPTCHA or bot check detected",
                        url=url,
                        job_id=job_id,
                        attempt=attempt,
                        screenshot_file=screenshot,
                    )
                    raise RuntimeError("CAPTCHA or bot check detected")

                if self._is_out_of_stock(page):
                    screenshot = self._take_screenshot(page, asin, "out_of_stock")
                    log_error(
                        scraper_type="product",
                        context=asin,
                        error_type="out_of_stock",
                        error_message="Product out of stock or page not found",
                        url=url,
                        job_id=job_id,
                        attempt=attempt,
                        screenshot_file=screenshot,
                    )
                    logger.warning(f"[PS] {asin} is out of stock or no page found")
                    return {"asin": asin, "error": "out_of_stock_or_no_page"}

                self._scroll(page)

                product_info_box = self._get_product_info_box(page)
                technical_details = self._get_technical_details(page)

                title = self._get_title(page)
                if not title:
                    screenshot = self._take_screenshot(page, asin, "no_title")
                    log_error(
                        scraper_type="product",
                        context=asin,
                        error_type="no_title",
                        error_message="Could not extract product title",
                        url=url,
                        job_id=job_id,
                        attempt=attempt,
                        screenshot_file=screenshot,
                    )

                price = self._get_price(page)
                if price is None:
                    screenshot = self._take_screenshot(page, asin, "no_price")
                    log_error(
                        scraper_type="product",
                        context=asin,
                        error_type="no_price",
                        error_message="Could not extract product price",
                        url=url,
                        job_id=job_id,
                        attempt=attempt,
                        screenshot_file=screenshot,
                    )

                blm = self._get_blm(page)
                avg_rating = self._get_avg_rating(page, product_info_box)
                ratings = self._get_ratings(page, product_info_box)
                image = self._get_image(page)
                store = self._get_store(page, technical_details)
                manufacturer = self._get_manufacturer(product_info_box, technical_details)
                variants = self._get_variants(page)

                rank_data = self._get_rank_data(product_info_box)
                main_category = rank_data.get("main_category")
                second_category = rank_data.get("second_category")

                if not main_category or not second_category:
                    bc_main, bc_second = self._get_breadcrumb_categories(page)
                    main_category = main_category or bc_main
                    second_category = second_category or bc_second

                total_revenue = round(blm * price, 2) if blm and price else None

                return {
                    "asin": asin,
                    "title": title,
                    "price": price,
                    "blm": blm,
                    "total_revenue": total_revenue,
                    "avg_rating": avg_rating,
                    "ratings": ratings,
                    "main_category": main_category,
                    "main_category_rank": rank_data.get("main_category_rank"),
                    "second_category": second_category,
                    "second_category_rank": rank_data.get("second_category_rank"),
                    "manufacturer": manufacturer,
                    "store": store,
                    "img_path": image,
                    "variants": variants,
                    "variants_count": len(variants) if variants else 0,
                }
            finally:
                context.close()
                browser.close()

    # ── helpers ────────────────────────────────────────────────────────────────

    def _take_screenshot(self, page: Page, asin: str, error_type: str) -> Optional[str]:
        try:
            from datetime import datetime, timezone
            ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            filename = f"{ts}_{asin}_{error_type}.png"
            page.screenshot(path=str(SCREENSHOTS_DIR / filename), full_page=False)
            return filename
        except Exception as e:
            logger.warning(f"[PS] Screenshot failed: {e}")
            return None

    def _handle_continue_shopping(self, page: Page):
        """Click through Amazon's 'Click the button below to continue shopping' interstitial."""
        try:
            content = page.content()
            if "Click the button below to continue shopping" not in content:
                return
            logger.info("[PS] Detected 'continue shopping' interstitial — clicking through")
            for sel in ["input[type='submit']", "button:has-text('Continue')", "input[value*='Continue']"]:
                btn = page.query_selector(sel)
                if btn:
                    btn.click()
                    page.wait_for_load_state("domcontentloaded", timeout=15000)
                    time.sleep(random.uniform(1.5, 2.5))
                    logger.info("[PS] Clicked through interstitial successfully")
                    return
        except Exception as e:
            logger.warning(f"[PS] continue_shopping click failed: {e}")

    def _is_captcha(self, page: Page) -> bool:
        try:
            title = page.title().lower()
            if "captcha" in title or "robot" in title:
                return True
            content = page.content()
            return (
                "Type the characters you see in this image" in content
                or "Enter the characters you see below" in content
            )
        except Exception:
            return False

    def _is_out_of_stock(self, page: Page) -> bool:
        try:
            text = page.content().lower()
            return (
                "we couldn't find the" in text
                or "temporarily out of stock" in text
                or "no featured offers available" in text
                or "couldn't find the page" in text
            )
        except Exception:
            return False

    def _scroll(self, page: Page):
        for _ in range(4):
            page.evaluate("window.scrollBy(0, window.innerHeight * 0.8)")
            time.sleep(random.uniform(0.4, 0.8))
        page.evaluate("window.scrollTo(0, 0)")
        time.sleep(0.3)

    def _inner_text(self, el: Optional[ElementHandle]) -> Optional[str]:
        if not el:
            return None
        try:
            return el.inner_text().strip() or None
        except Exception:
            return None

    def _get_title(self, page: Page) -> Optional[str]:
        try:
            el = page.query_selector("#productTitle")
            return self._inner_text(el)
        except Exception as e:
            logger.warning(f"[PS] title: {e}")
            return None

    def _get_price(self, page: Page) -> Optional[float]:
        selectors = [
            "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
            "#corePrice_feature_div .a-price .a-offscreen",
            "#corePrice_desktop .a-price .a-offscreen",
            ".reinventPricePriceToPayMargin .a-offscreen",
            "#apex_offerDisplay_desktop .a-price .a-offscreen",
            "#buyBoxAccordion .a-price .a-offscreen",
            "#newAccordionRow_feature_div .a-price .a-offscreen",
            "#exports_desktop_qualifiedBuybox_tlc_feature_div .a-price .a-offscreen",
            "#qualifiedBuyBox .a-price .a-offscreen",
            "#moreBuyingChoices_feature_div .a-price .a-offscreen",
            ".a-price[data-a-size='xl'] .a-offscreen",
            ".a-price[data-a-size='l'] .a-offscreen",
        ]
        for sel in selectors:
            try:
                el = page.query_selector(sel)
                text = self._inner_text(el)
                if text:
                    price = self._parse_price(text)
                    if price is not None:
                        return price
            except Exception:
                continue
        try:
            content = page.content()
            m = re.search(r'"priceAmount"\s*:\s*"?([\d]+\.[\d]{2})"?', content)
            if m:
                return float(m.group(1))
            m = re.search(r'(?:EUR|USD|GBP|CAD|AUD|€|£)\s*([\d,]+\.\d{2})', content)
            if m:
                return float(m.group(1).replace(",", ""))
            m = re.search(r'\$\s*([\d,]+\.\d{2})', content)
            if m:
                return float(m.group(1).replace(",", ""))
        except Exception:
            pass
        logger.warning("[PS] No price found")
        return None

    def _parse_price(self, text: str) -> Optional[float]:
        try:
            text = re.sub(r"\([^)]*\)", "", text)
            # Strip currency symbols/codes, keep digits, dots, newlines
            cleaned = re.sub(r"[^\d\n\.]", "", text)
            m = re.search(r"(\d+)\n(\d{2})", cleaned)
            if m:
                return float(f"{m.group(1)}.{m.group(2)}")
            m = re.search(r"(\d+)\.(\d{2})", cleaned)
            if m:
                return float(f"{m.group(1)}.{m.group(2)}")
            m = re.search(r"(\d+)", cleaned)
            if m:
                return float(m.group(1))
        except Exception:
            pass
        return None

    def _get_blm(self, page: Page) -> Optional[int]:
        selectors = [
            "#socialProofingAsinFaceout_feature_div",
            "#centerCol div[id*='socialProof']",
        ]
        for sel in selectors:
            try:
                el = page.query_selector(sel)
                text = self._inner_text(el)
                if text and ("bought" in text.lower() or "past month" in text.lower()):
                    text = text.replace("bought", "").replace("K", "000").replace("+", "").replace("in past month", "").strip()
                    nums = re.findall(r"\d+", text.replace(",", ""))
                    if nums:
                        return int(nums[0])
            except Exception:
                continue
        try:
            content = page.content()
            m = re.search(r"([\d,]+)\+?\s*(?:K\+?\s*)?bought in past month", content, re.IGNORECASE)
            if m:
                val = m.group(1).replace(",", "")
                if "K" in m.group(0):
                    return int(val) * 1000
                return int(val)
        except Exception:
            pass
        return None

    def _get_avg_rating(self, page: Page, info_box: dict) -> Optional[float]:
        if "Customer Reviews" in info_box:
            m = re.search(r"(\d+\.\d+)\s+[\d,]+ rating", info_box["Customer Reviews"])
            if m:
                return float(m.group(1))
        try:
            for sel in [
                "#acrPopover span.a-icon-alt",
                "#averageCustomerReviews span.a-icon-alt",
                "span[data-hook='rating-out-of-text']",
            ]:
                el = page.query_selector(sel)
                text = self._inner_text(el)
                if text:
                    m = re.search(r"(\d+(?:\.\d+)?)", text)
                    if m:
                        return float(m.group(1))
        except Exception as e:
            logger.warning(f"[PS] avg_rating: {e}")
        return None

    def _get_ratings(self, page: Page, info_box: dict) -> Optional[int]:
        if "Customer Reviews" in info_box:
            m = re.search(r"(\d+\.\d+)\s+([\d,]+) rating", info_box["Customer Reviews"])
            if m:
                return int(m.group(2).replace(",", ""))
        try:
            for sel in [
                "#acrCustomerReviewText",
                "span[data-hook='total-review-count']",
            ]:
                el = page.query_selector(sel)
                text = self._inner_text(el)
                if text:
                    m = re.search(r"([\d,]+)", text)
                    if m:
                        return int(m.group(1).replace(",", ""))
        except Exception as e:
            logger.warning(f"[PS] ratings: {e}")
        return None

    def _get_image(self, page: Page) -> Optional[str]:
        try:
            el = page.query_selector("#imgTagWrapperId img")
            if el:
                return el.get_attribute("src")
        except Exception as e:
            logger.warning(f"[PS] image: {e}")
        return None

    def _get_store(self, page: Page, technical_details: dict) -> Optional[str]:
        try:
            el = page.query_selector("#bylineInfo")
            text = self._inner_text(el)
            if text:
                cleaned = text.replace("Visit the ", "").replace(" Store", "").replace("Brand:", "").strip()
                return cleaned or None
        except Exception:
            pass
        return self._clean_brand(technical_details.get("Brand"))

    def _get_manufacturer(self, info_box: dict, technical_details: dict) -> Optional[str]:
        return (
            self._clean_brand(info_box.get("Manufacturer"))
            or self._clean_brand(technical_details.get("Manufacturer"))
        )

    def _clean_brand(self, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        value = re.sub(r"^(?:[Bb]rand\s*:?\s*)", "", value.strip())
        return value or None

    def _get_variants(self, page: Page) -> list[str]:
        try:
            items = page.query_selector_all("#twister-plus-inline-twister [data-csa-c-item-id]")
            if not items:
                items = page.query_selector_all("[data-asin-type='variation'] [data-csa-c-item-id]")
            variants = []
            for el in items:
                val = el.get_attribute("data-csa-c-item-id")
                if val:
                    variants.append(val)
            return variants[1:] if len(variants) > 1 else []
        except Exception as e:
            logger.warning(f"[PS] variants: {e}")
            return []

    def _get_product_info_box(self, page: Page) -> dict:
        info: dict = {}
        try:
            for sel in [
                "#detailBulletsWrapper_feature_div ul li",
                "#detail-bullets .content li",
            ]:
                items = page.query_selector_all(sel)
                for item in items:
                    text = self._inner_text(item)
                    if text and ":" in text:
                        parts = text.split(":", 1)
                        key = parts[0].strip()
                        val = parts[1].strip()
                        if key and val:
                            info[key] = val
                if info:
                    break
        except Exception as e:
            logger.warning(f"[PS] info_box ul: {e}")

        try:
            for sel in [
                "#productDetails_feature_div table tr",
                "#productDetails_detailBullets_sections1 tr",
                "#productDetails_techSpec_section_1 tr",
            ]:
                rows = page.query_selector_all(sel)
                for row in rows:
                    th = row.query_selector("th")
                    td = row.query_selector("td")
                    if th and td:
                        key = self._inner_text(th)
                        val = self._inner_text(td)
                        if key and val:
                            info[key] = val
                if rows:
                    break
        except Exception as e:
            logger.warning(f"[PS] info_box table: {e}")

        return info

    def _get_technical_details(self, page: Page) -> dict:
        info: dict = {}
        try:
            sections = page.query_selector_all("h3, h2")
            for section in sections:
                text = self._inner_text(section)
                if not text or "Technical Details" not in text:
                    continue
                try:
                    table = section.evaluate_handle(
                        "el => el.closest('div, section')?.querySelector('table')"
                    )
                    if table:
                        rows = table.as_element().query_selector_all("tr") if table.as_element() else []
                        for row in rows:
                            th = row.query_selector("th")
                            td = row.query_selector("td")
                            if th and td:
                                key = self._inner_text(th)
                                val = self._inner_text(td)
                                if key and val:
                                    info[key] = val
                except Exception:
                    continue
        except Exception as e:
            logger.warning(f"[PS] technical_details: {e}")
        return info

    def _get_rank_data(self, info_box: dict) -> dict:
        empty = {"main_category": None, "main_category_rank": None,
                 "second_category": None, "second_category_rank": None}
        rank_text = info_box.get("Best Sellers Rank")
        if not rank_text:
            return empty
        try:
            rank_items = rank_text.split("#")[1:]
            main_rank = main_cat = second_rank = second_cat = None

            if rank_items:
                parts = rank_items[0].split(" in ", 1)
                if len(parts) == 2:
                    main_rank = self._parse_rank_int(parts[0])
                    main_cat = re.sub(r"\s*\([^)]*\)", "", parts[1]).strip()

            if len(rank_items) > 1:
                parts = rank_items[1].split(" in ", 1)
                if len(parts) == 2:
                    second_rank = self._parse_rank_int(parts[0])
                    second_cat = re.sub(r"\s*\([^)]*\)", "", parts[1]).strip()

            return {
                "main_category": main_cat,
                "main_category_rank": main_rank,
                "second_category": second_cat,
                "second_category_rank": second_rank,
            }
        except Exception as e:
            logger.warning(f"[PS] rank_data: {e}")
            return empty

    def _parse_rank_int(self, text: str) -> Optional[int]:
        try:
            return int(text.replace(",", "").strip())
        except Exception:
            return None

    def _get_breadcrumb_categories(self, page: Page) -> tuple[Optional[str], Optional[str]]:
        selectors = [
            "#wayfinding-breadcrumbs_container a",
            "#wayfinding-breadcrumbs-container a",
            ".a-breadcrumb a",
        ]
        for sel in selectors:
            try:
                els = page.query_selector_all(sel)
                cats = []
                for el in els:
                    text = self._inner_text(el)
                    if text and not text.startswith("Back to"):
                        cats.append(text)
                cats = list(dict.fromkeys(cats))
                if cats:
                    return cats[0], cats[-1]
            except Exception:
                continue
        return None, None
