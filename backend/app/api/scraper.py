from fastapi import APIRouter
from pydantic import BaseModel

from app.scrapers.first_page_scraper import FirstPageScraper
from app.scrapers.product_scraper import ProductScraper

router = APIRouter(prefix="/scraper", tags=["scraper"])


class FirstPageRequest(BaseModel):
    keyword: str
    headless: bool = True


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


class ProductRequest(BaseModel):
    asin: str
    headless: bool = True


@router.post("/first-page", response_model=FirstPageResponse)
async def scrape_first_page(request: FirstPageRequest) -> FirstPageResponse:
    scraper = FirstPageScraper(headless=request.headless)
    result = await scraper.scrape(request.keyword)
    products = result.get("products", [])
    return FirstPageResponse(
        keyword=request.keyword,
        count=len(products),
        products=[ScrapedProduct(**p) for p in products],
        suggestions=result.get("suggestions", []),
    )


@router.post("/product")
async def scrape_product(request: ProductRequest):
    scraper = ProductScraper(headless=request.headless)
    result = await scraper.scrape(request.asin)
    if result is None:
        return {"asin": request.asin, "error": "scrape_failed"}
    return result
