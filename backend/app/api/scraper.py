from fastapi import APIRouter
from pydantic import BaseModel

from app.scrapers.first_page_scraper import FirstPageScraper
from app.scrapers.product_scraper import ProductScraper
from app.db.paths import SCREENSHOTS_DIR

router = APIRouter(prefix="/scraper", tags=["scraper"])


class FirstPageRequest(BaseModel):
    keyword: str
    headless: bool = True
    test_screenshot: bool = False


class ScrapedProduct(BaseModel):
    asin: str
    title: str
    price: float | None
    image: str | None


class FirstPageResponse(BaseModel):
    keyword: str
    count: int
    products: list[ScrapedProduct]
    suggestions: list[str]
    test_screenshot: str | None = None
    debug: dict | None = None


class ProductRequest(BaseModel):
    asin: str
    headless: bool = True
    test_screenshot: bool = False


@router.post("/first-page", response_model=FirstPageResponse)
async def scrape_first_page(request: FirstPageRequest) -> FirstPageResponse:
    scraper = FirstPageScraper(headless=request.headless)
    result = await scraper.scrape(request.keyword, test_screenshot=request.test_screenshot)
    products = result.get("products", [])
    return FirstPageResponse(
        keyword=request.keyword,
        count=len(products),
        products=[ScrapedProduct(**p) for p in products],
        suggestions=result.get("suggestions", []),
        test_screenshot=result.get("test_screenshot"),
        debug=result.get("_debug"),
    )


@router.post("/product")
async def scrape_product(request: ProductRequest):
    scraper = ProductScraper(headless=request.headless)
    result = await scraper.scrape(request.asin, test_screenshot=request.test_screenshot)
    if result is None:
        return {"asin": request.asin, "error": "scrape_failed"}
    return result


@router.delete("/test-screenshots")
async def delete_test_screenshots() -> dict:
    deleted = 0
    for f in SCREENSHOTS_DIR.glob("test_*.png"):
        try:
            f.unlink()
            deleted += 1
        except Exception:
            pass
    return {"deleted": deleted}
