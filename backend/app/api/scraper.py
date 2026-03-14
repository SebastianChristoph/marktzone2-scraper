from fastapi import APIRouter
from pydantic import BaseModel

from app.scrapers.http_scraper import scrape_first_page_http, scrape_product_http

router = APIRouter(prefix="/scraper", tags=["scraper"])


class FirstPageRequest(BaseModel):
    keyword: str


class ProductRequest(BaseModel):
    asin: str


@router.post("/first-page")
async def scrape_first_page(request: FirstPageRequest):
    result = await scrape_first_page_http(request.keyword)
    return result


@router.post("/product")
async def scrape_product(request: ProductRequest):
    result = await scrape_product_http(request.asin)
    if result is None:
        return {"asin": request.asin, "error": "scrape_failed"}
    return result
