from fastapi import APIRouter
from pydantic import BaseModel

from app.scrapers.http_scraper import scrape_first_page_http, scrape_product_http

router = APIRouter(prefix="/scraper", tags=["scraper"])


class FirstPageRequest(BaseModel):
    keyword: str


class ScrapedProduct(BaseModel):
    asin: str


class FirstPageResponse(BaseModel):
    keyword: str
    count: int
    products: list[ScrapedProduct]
    suggestions: list[str]


class ProductRequest(BaseModel):
    asin: str


@router.post("/first-page", response_model=FirstPageResponse)
async def scrape_first_page(request: FirstPageRequest) -> FirstPageResponse:
    result = await scrape_first_page_http(request.keyword)
    products = result.get("products", [])
    return FirstPageResponse(
        keyword=request.keyword,
        count=len(products),
        products=[ScrapedProduct(**p) for p in products],
        suggestions=result.get("suggestions", []),
    )


@router.post("/product")
async def scrape_product(request: ProductRequest):
    result = await scrape_product_http(request.asin)
    if result is None:
        return {"asin": request.asin, "error": "scrape_failed"}
    return result
