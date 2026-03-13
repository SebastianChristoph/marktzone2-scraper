"""
Exploratory scraper endpoints — raw HTTP (no Playwright, no proxy).
Used for testing the viability of HTTP-based scraping as a Playwright replacement.
"""
import logging
import time

from fastapi import APIRouter
from pydantic import BaseModel

from app.scrapers.http_scraper import (
    scrape_first_page_http,
    scrape_product_http,
    scrape_cluster_http,
)

router = APIRouter(prefix="/exploratory", tags=["exploratory"])
logger = logging.getLogger(__name__)


class FirstPageRequest(BaseModel):
    keyword: str


class ProductRequest(BaseModel):
    asin: str


class ClusterRequest(BaseModel):
    markets: list[str]
    concurrency: int = 10


@router.post("/first-page")
async def test_first_page(req: FirstPageRequest) -> dict:
    """Scrape a single Amazon search page using raw HTTP."""
    logger.info(f"[Exploratory] First page: '{req.keyword}'")
    return await scrape_first_page_http(req.keyword)


@router.post("/product")
async def test_product(req: ProductRequest) -> dict:
    """Scrape a single Amazon product page using raw HTTP."""
    logger.info(f"[Exploratory] Product: {req.asin}")
    return await scrape_product_http(req.asin)


@router.post("/cluster")
async def test_cluster(req: ClusterRequest) -> dict:
    """
    Full cluster pipeline: scrape 1-4 markets → collect ASINs → scrape all products.
    Runs with configurable concurrency (default 10 parallel HTTP requests).
    """
    if len(req.markets) > 10:
        return {"error": "Max 10 markets for exploratory test"}
    logger.info(f"[Exploratory] Cluster: {len(req.markets)} markets, concurrency={req.concurrency}")
    return await scrape_cluster_http(req.markets, concurrency=req.concurrency)
