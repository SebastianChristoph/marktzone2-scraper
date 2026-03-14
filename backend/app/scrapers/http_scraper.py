"""
Raw HTTP scrapers — no Playwright, no browser.
Uses httpx (async) + BeautifulSoup for HTML parsing.
Supports optional datacenter proxy rotation via DC_PROXY_LIST env var.
Drop-in replacement for first_page_scraper.py and product_scraper.py.
"""
import asyncio
import logging
import os
import random
import re
import time
from typing import Optional

import httpx
from bs4 import BeautifulSoup, Tag

logger = logging.getLogger(__name__)

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
]

_DEFAULT_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Upgrade-Insecure-Requests": "1",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "DNT": "1",
}

# ── Proxy Pool ───────────────────────────────────────────────────────────────
#
# Set DC_PROXY_LIST in .env as comma-separated proxy URLs:
#   DC_PROXY_LIST=http://user:pass@ip1:port,http://user:pass@ip2:port,...
#
# Or for Webshare-style rotating proxy (single endpoint, random session):
#   DC_PROXY_URL=http://user:pass@proxy.host:port
#   DC_PROXY_SESSIONS=50  (number of rotating sessions, default 10)
#
# If neither is set, requests go direct (no proxy).

_proxy_pool: list[str] = []
_proxy_initialized = False


def _init_proxies() -> None:
    global _proxy_pool, _proxy_initialized
    if _proxy_initialized:
        return
    _proxy_initialized = True

    # Option 1: Webshare download URL — format: IP:Port:User:Pass per line
    download_url = os.getenv("WEBSHARE_PROXY_DOWNLOAD_URL", "").strip()
    if download_url:
        try:
            import requests as _req
            resp = _req.get(download_url, timeout=10)
            resp.raise_for_status()
            for line in resp.text.strip().splitlines():
                parts = line.strip().split(":")
                if len(parts) == 4:
                    ip, port, user, pw = parts
                    _proxy_pool.append(f"http://{user}:{pw}@{ip}:{port}")
            logger.info(f"[HTTP] Loaded {len(_proxy_pool)} DC proxies from Webshare download URL")
            return
        except Exception as e:
            logger.warning(f"[HTTP] Webshare download URL fetch failed: {e} — falling back to DC_PROXY_LIST")

    # Option 2: Explicit comma-separated list
    proxy_list = os.getenv("DC_PROXY_LIST", "").strip()
    if proxy_list:
        _proxy_pool = [p.strip() for p in proxy_list.split(",") if p.strip()]
        logger.info(f"[HTTP] Loaded {len(_proxy_pool)} DC proxies from DC_PROXY_LIST")
        return

    logger.info("[HTTP] No DC proxy configured — requests go direct")


def get_proxy_pool() -> list[str]:
    """Return the full proxy pool (triggers init on first call)."""
    _init_proxies()
    return list(_proxy_pool)


def _get_proxy() -> Optional[str]:
    """Return a random proxy URL from the pool, or None if no proxies configured."""
    _init_proxies()
    if not _proxy_pool:
        return None
    return random.choice(_proxy_pool)


def _make_client(timeout: float = 30.0) -> httpx.AsyncClient:
    """Create an httpx client with optional proxy."""
    proxy = _get_proxy()
    return httpx.AsyncClient(
        follow_redirects=True,
        timeout=timeout,
        proxy=proxy,
    )


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_headers() -> dict:
    return {**_DEFAULT_HEADERS, "User-Agent": random.choice(USER_AGENTS)}


def _text(el: Optional[Tag]) -> Optional[str]:
    if el is None:
        return None
    t = el.get_text(strip=True)
    return t if t else None


def _is_captcha(html: str) -> bool:
    lower = html.lower()
    return (
        "captcha" in lower
        or "type the characters you see in this image" in lower
        or "enter the characters you see below" in lower
        or "something went wrong on our end" in lower
        or "meet the dogs of amazon" in lower
    )


def _is_out_of_stock(html: str) -> bool:
    lower = html.lower()
    return (
        "we couldn't find the" in lower
        or "couldn&#039;t find the" in lower
        or "temporarily out of stock" in lower
        or "no featured offers available" in lower
        or "couldn't find the page" in lower
    )


def _parse_price(text: str) -> Optional[float]:
    text = re.sub(r"\([^)]*\)", "", text)
    cleaned = re.sub(r"[^\d\n.]", "", text)
    m = re.search(r"(\d+)\.(\d{2})", cleaned)
    if m:
        return float(f"{m.group(1)}.{m.group(2)}")
    m = re.search(r"(\d+)", cleaned)
    if m:
        return float(m.group(1))
    return None


def _parse_rank_int(text: str) -> Optional[int]:
    try:
        return int(text.replace(",", "").strip())
    except Exception:
        return None


def _parse_bsr_text(rank_text: str) -> dict:
    empty = {"main_category": None, "main_category_rank": None,
             "second_category": None, "second_category_rank": None}
    try:
        rank_items = rank_text.split("#")[1:]
        main_rank = main_cat = second_rank = second_cat = None
        if rank_items:
            parts = rank_items[0].split(" in ", 1)
            if len(parts) == 2:
                main_rank = _parse_rank_int(parts[0])
                raw = re.sub(r"\s*\([^)]*\)", "", parts[1])
                main_cat = re.sub(r"\s+", " ", raw.replace("\n", " ")).strip() or None
        if len(rank_items) > 1:
            parts = rank_items[1].split(" in ", 1)
            if len(parts) == 2:
                second_rank = _parse_rank_int(parts[0])
                raw = re.sub(r"\s*\([^)]*\)", "", parts[1])
                second_cat = re.sub(r"\s+", " ", raw.replace("\n", " ")).strip() or None
        return {
            "main_category": main_cat, "main_category_rank": main_rank,
            "second_category": second_cat, "second_category_rank": second_rank,
        }
    except Exception:
        return empty


# ── First Page Scraper ───────────────────────────────────────────────────────

async def scrape_first_page_http(keyword: str) -> dict:
    """Scrape Amazon search results page using raw HTTP. Returns ASINs list."""
    url = f"https://www.amazon.com/s?k={keyword.replace(' ', '+')}"

    await asyncio.sleep(random.uniform(0.2, 1.2))

    t0 = time.monotonic()
    proxy_used = _get_proxy() is not None
    async with _make_client() as client:
        resp = await client.get(url, headers=_make_headers())

    duration = round(time.monotonic() - t0, 2)
    html = resp.text

    if resp.status_code != 200:
        return {
            "keyword": keyword, "products": [], "count": 0,
            "error": f"HTTP {resp.status_code}",
            "duration_s": duration, "method": "raw_http", "proxy": proxy_used,
        }

    if _is_captcha(html):
        return {
            "keyword": keyword, "products": [], "count": 0,
            "error": "CAPTCHA detected",
            "duration_s": duration, "method": "raw_http", "proxy": proxy_used,
        }

    soup = BeautifulSoup(html, "lxml")

    # Extract ASINs
    seen: set[str] = set()
    products: list[dict] = []
    for el in soup.select("[data-asin]"):
        asin = el.get("data-asin", "").strip()
        if asin and asin not in seen:
            seen.add(asin)
            products.append({"asin": asin})

    # Extract suggestions from page (autocomplete data is sometimes embedded)
    suggestions: list[str] = []
    # Try embedded suggestion data
    for m in re.findall(r'"alias":"aps","prefix":"[^"]*","suffix":"([^"]*)"', html):
        if m and keyword.lower() in m.lower():
            suggestions.append(m)
    suggestions = suggestions[:10]

    logger.info(f"[HTTP-FP] '{keyword}' → {len(products)} ASINs, {len(suggestions)} suggestions ({duration}s)")
    return {
        "keyword": keyword,
        "products": products,
        "count": len(products),
        "suggestions": suggestions,
        "duration_s": duration,
        "method": "raw_http",
        "http_status": resp.status_code,
        "proxy": proxy_used,
    }


# ── Product Scraper ──────────────────────────────────────────────────────────

async def scrape_product_http(asin: str) -> dict:
    """Scrape Amazon product detail page using raw HTTP. Returns product data dict."""
    url = f"https://www.amazon.com/dp/{asin}?language=en_US"

    # Jitter: randomise request timing to avoid simultaneous hits on the same IP
    await asyncio.sleep(random.uniform(0.3, 1.5))

    t0 = time.monotonic()
    proxy_used = _get_proxy() is not None

    async with _make_client() as client:
        resp = await client.get(url, headers=_make_headers())

    duration = round(time.monotonic() - t0, 2)
    html = resp.text

    if resp.status_code != 200:
        return {"asin": asin, "error": f"HTTP {resp.status_code}", "duration_s": duration, "method": "raw_http", "proxy": proxy_used}

    if _is_captcha(html):
        return {"asin": asin, "error": "CAPTCHA detected", "duration_s": duration, "method": "raw_http", "proxy": proxy_used}

    if _is_out_of_stock(html):
        return {"asin": asin, "error": "out_of_stock_or_no_page", "duration_s": duration, "method": "raw_http", "proxy": proxy_used}

    soup = BeautifulSoup(html, "lxml")

    title = _extract_title(soup)
    price = _extract_price(soup, html)
    blm = _extract_blm(soup, html)
    avg_rating = _extract_avg_rating(soup)
    ratings = _extract_ratings(soup)
    image = _extract_image(soup)
    store = _extract_store(soup)
    info_box = _extract_info_box(soup)
    manufacturer = _extract_manufacturer(info_box)
    rank_data = _extract_rank_data(info_box, html)

    # Breadcrumb fallback for categories
    if not rank_data.get("main_category") or not rank_data.get("second_category"):
        bc_main, bc_second = _extract_breadcrumbs(soup)
        rank_data["main_category"] = rank_data.get("main_category") or bc_main
        rank_data["second_category"] = rank_data.get("second_category") or bc_second

    total_revenue = round(blm * price, 2) if blm and price else None

    return {
        "asin": asin,
        "title": title,
        "price": price,
        "blm": blm,
        "total_revenue": total_revenue,
        "avg_rating": avg_rating,
        "ratings": ratings,
        "main_category": rank_data.get("main_category"),
        "main_category_rank": rank_data.get("main_category_rank"),
        "second_category": rank_data.get("second_category"),
        "second_category_rank": rank_data.get("second_category_rank"),
        "manufacturer": manufacturer,
        "store": store,
        "img_path": image,
        "duration_s": duration,
        "method": "raw_http",
        "http_status": resp.status_code,
        "proxy": proxy_used,
    }


# ── Product field extractors ─────────────────────────────────────────────────

def _extract_title(soup: BeautifulSoup) -> Optional[str]:
    el = soup.select_one("#productTitle")
    return _text(el)


def _extract_price(soup: BeautifulSoup, html: str) -> Optional[float]:
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
        el = soup.select_one(sel)
        t = _text(el)
        if t:
            p = _parse_price(t)
            if p is not None:
                return p
    # Regex fallbacks on raw HTML
    m = re.search(r'"priceAmount"\s*:\s*"?([\d]+\.[\d]{2})"?', html)
    if m:
        return float(m.group(1))
    m = re.search(r'\$\s*([\d,]+\.\d{2})', html)
    if m:
        return float(m.group(1).replace(",", ""))
    return None


def _extract_blm(soup: BeautifulSoup, html: str) -> Optional[int]:
    for sel in ["#socialProofingAsinFaceout_feature_div", "#centerCol div[id*='socialProof']"]:
        el = soup.select_one(sel)
        t = _text(el)
        if t and ("bought" in t.lower() or "past month" in t.lower()):
            t2 = t.replace("bought", "").replace("K", "000").replace("+", "").replace("in past month", "").strip()
            nums = re.findall(r"\d+", t2.replace(",", ""))
            if nums:
                return int(nums[0])
    m = re.search(r"([\d,]+)\+?\s*(?:K\+?\s*)?bought in past month", html, re.IGNORECASE)
    if m:
        val = m.group(1).replace(",", "")
        if "K" in m.group(0):
            return int(val) * 1000
        return int(val)
    return None


def _extract_avg_rating(soup: BeautifulSoup) -> Optional[float]:
    for sel in ["#acrPopover span.a-icon-alt", "#averageCustomerReviews span.a-icon-alt",
                "span[data-hook='rating-out-of-text']"]:
        el = soup.select_one(sel)
        t = _text(el)
        if t:
            m = re.search(r"(\d+(?:\.\d+)?)", t)
            if m:
                return float(m.group(1))
    return None


def _extract_ratings(soup: BeautifulSoup) -> Optional[int]:
    for sel in ["#acrCustomerReviewText", "span[data-hook='total-review-count']"]:
        el = soup.select_one(sel)
        t = _text(el)
        if t:
            m = re.search(r"([\d,]+)", t)
            if m:
                return int(m.group(1).replace(",", ""))
    return None


def _extract_image(soup: BeautifulSoup) -> Optional[str]:
    el = soup.select_one("#imgTagWrapperId img")
    if el:
        return el.get("src")
    el = soup.select_one("#landingImage")
    if el:
        return el.get("src")
    return None


def _extract_store(soup: BeautifulSoup) -> Optional[str]:
    el = soup.select_one("#bylineInfo")
    t = _text(el)
    if t:
        cleaned = t.replace("Visit the ", "").replace(" Store", "").replace("Brand:", "").strip()
        return cleaned or None
    return None


def _extract_info_box(soup: BeautifulSoup) -> dict:
    info: dict = {}
    # Detail bullets
    for li in soup.select("#detailBulletsWrapper_feature_div ul li"):
        t = _text(li)
        if t and ":" in t:
            parts = t.split(":", 1)
            key = parts[0].strip().replace("\u200f", "").replace("\u200e", "").replace("\u00a0", " ")
            val = parts[1].strip()
            if key and val:
                info[key] = val
    # Table rows
    for sel in [
        "#productDetails_detailBullets_sections1 tr",
        "#productDetails_detailBullets_sections2 tr",
        "#productDetails_feature_div table tr",
        "#productDetails_techSpec_section_1 tr",
        "#productDetails_techSpec_section_2 tr",
        "#productDetails_db_sections tr",
    ]:
        for row in soup.select(sel):
            th = row.select_one("th")
            td = row.select_one("td")
            if th and td:
                key = _text(th)
                val = _text(td)
                if key and val:
                    key = key.replace("\u00a0", " ").strip()
                    info[key] = val
    return info


def _extract_manufacturer(info_box: dict) -> Optional[str]:
    for key in ("Manufacturer", "Brand"):
        val = info_box.get(key)
        if val:
            cleaned = re.sub(r"^(?:[Bb]rand\s*:?\s*)", "", val.strip())
            return cleaned or None
    return None


def _extract_rank_data(info_box: dict, html: str) -> dict:
    empty = {"main_category": None, "main_category_rank": None,
             "second_category": None, "second_category_rank": None}

    # 1) Info box lookup
    for key in info_box:
        if key.replace("\u00a0", " ").strip() == "Best Sellers Rank":
            parsed = _parse_bsr_text(info_box[key])
            if parsed.get("main_category_rank") is not None:
                return parsed

    # 2) Regex on raw HTML
    content = html.replace("&nbsp;", " ").replace("\xa0", " ")
    bsr_section = re.search(r"Best\s+Sellers?\s+Rank.*?(?=#\d)", content, re.IGNORECASE | re.DOTALL)
    search_text = content[bsr_section.start():bsr_section.start() + 600] if bsr_section else content
    matches = re.findall(r"#([\d,]+)\s+in\s+([A-Za-z][^<\n#(]{2,60}?)(?=\s*[<\n(#])", search_text)
    if matches:
        main_rank = _parse_rank_int(matches[0][0])
        main_cat = re.sub(r"\s+", " ", matches[0][1]).strip() or None
        second_rank = _parse_rank_int(matches[1][0]) if len(matches) > 1 else None
        second_cat = re.sub(r"\s+", " ", matches[1][1]).strip() if len(matches) > 1 else None
        if main_rank is not None:
            return {
                "main_category": main_cat, "main_category_rank": main_rank,
                "second_category": second_cat, "second_category_rank": second_rank,
            }
    return empty


def _extract_breadcrumbs(soup: BeautifulSoup) -> tuple[Optional[str], Optional[str]]:
    for sel in ["#wayfinding-breadcrumbs_container a", "#wayfinding-breadcrumbs-container a", ".a-breadcrumb a"]:
        els = soup.select(sel)
        cats = []
        for el in els:
            t = _text(el)
            if t and not t.startswith("Back to"):
                cats.append(t)
        cats = list(dict.fromkeys(cats))
        if cats:
            return cats[0], cats[-1]
    return None, None


# ── Cluster Pipeline ─────────────────────────────────────────────────────────

async def scrape_cluster_http(
    markets: list[str],
    concurrency: int = 10,
    on_progress: Optional[callable] = None,
) -> dict:
    """
    Full pipeline: scrape search results for each market, collect unique ASINs,
    then scrape all product detail pages.
    on_progress(phase, done, total, message) is called for live updates.
    """
    t0 = time.monotonic()
    sem = asyncio.Semaphore(concurrency)

    # ── Phase 1: Market Discovery ────────────────────────────────────────────
    market_results: dict[str, dict] = {}
    all_asins: set[str] = set()
    market_errors = 0

    async def scrape_market(kw: str):
        async with sem:
            await asyncio.sleep(random.uniform(0.2, 1.0))
            return await scrape_first_page_http(kw)

    tasks = [scrape_market(kw) for kw in markets]
    for i, coro in enumerate(asyncio.as_completed(tasks)):
        result = await coro
        kw = result["keyword"]
        market_results[kw] = result
        asins = [p["asin"] for p in result.get("products", [])]
        all_asins.update(asins)
        if result.get("error"):
            market_errors += 1
        if on_progress:
            on_progress("market_discovery", i + 1, len(markets),
                        f"'{kw}' → {len(asins)} ASINs" + (f" ({result['error']})" if result.get("error") else ""))

    unique_asins = sorted(all_asins)

    # ── Phase 2: Product Scraping ────────────────────────────────────────────
    product_results: list[dict] = []
    product_errors = 0

    async def scrape_one_product(asin: str):
        async with sem:
            await asyncio.sleep(random.uniform(0.2, 1.5))
            return await scrape_product_http(asin)

    tasks = [scrape_one_product(a) for a in unique_asins]
    for i, coro in enumerate(asyncio.as_completed(tasks)):
        result = await coro
        product_results.append(result)
        if result.get("error"):
            product_errors += 1
        if on_progress and (i + 1) % 5 == 0:
            on_progress("product_scraping", i + 1, len(unique_asins),
                        f"{i + 1}/{len(unique_asins)} ASINs")

    if on_progress:
        on_progress("product_scraping", len(unique_asins), len(unique_asins), "done")

    duration = round(time.monotonic() - t0, 2)

    # Separate successes from failures
    successful = [p for p in product_results if not p.get("error")]
    failed = [p for p in product_results if p.get("error")]

    return {
        "markets": market_results,
        "markets_count": len(markets),
        "markets_errors": market_errors,
        "unique_asins": len(unique_asins),
        "products_scraped": len(successful),
        "products_failed": len(failed),
        "products": successful,
        "failed_products": failed,
        "duration_s": duration,
        "method": "raw_http",
        "concurrency": concurrency,
    }
