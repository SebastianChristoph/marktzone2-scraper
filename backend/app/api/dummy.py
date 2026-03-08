import asyncio
import random
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/dummy", tags=["dummy"])

FAKE_PRODUCTS = [
    ("Bosch IXO 6 Akkuschrauber", "B07XYZABC1"),
    ("Philips Hue White E27 Starter Kit", "B08QRSTUVW"),
    ("Braun Series 9 Elektrorasierer", "B09MNOPQR2"),
    ("WD Elements 2TB externe Festplatte", "B06DEFGHIJ"),
    ("Anker PowerCore 20100 Powerbank", "B01KLMNOPQ"),
    ("Samsung T7 Portable SSD 1TB", "B08VWXYZ34"),
    ("Sony WH-1000XM5 Kopfhörer", "B0ARSTUVWX"),
    ("Garmin Forerunner 255 GPS-Uhr", "B0BCDEFGHI"),
]

CATEGORIES = ["Elektronik", "Computer & Zubehör", "Küche & Haushalt", "Sport & Freizeit"]
MANUFACTURERS = ["Bosch", "Philips", "Samsung", "Sony", "Anker", "WD", "Garmin", "Braun"]


class ScrapeRequest(BaseModel):
    market_name: str


class FirstPageProduct(BaseModel):
    name: str
    asin: str


class FirstPageResponse(BaseModel):
    market_name: str
    products: list[FirstPageProduct]


class ProductDetail(BaseModel):
    asin: str
    title: str
    price: float
    total_revenue: float
    blm: float
    avg_rating: float
    ratings_count: int
    main_category: str | None
    main_category_rank: int | None
    second_category: str | None
    second_category_rank: int | None
    manufacturer: str | None
    store: str | None
    image_url: str | None
    last_scraped: str


class AsinScrapeRequest(BaseModel):
    asins: list[str]


@router.post("/scrape", response_model=FirstPageResponse)
async def dummy_scrape(request: ScrapeRequest) -> FirstPageResponse:
    await asyncio.sleep(12)
    count = random.randint(4, 5)
    sample = random.sample(FAKE_PRODUCTS, count)
    products = [FirstPageProduct(name=name, asin=asin) for name, asin in sample]
    return FirstPageResponse(market_name=request.market_name, products=products)


@router.post("/scrape-asins", response_model=list[ProductDetail])
async def dummy_scrape_asins(request: AsinScrapeRequest) -> list[ProductDetail]:
    await asyncio.sleep(8)
    results = []
    for asin in request.asins:
        title = next((name for name, a in FAKE_PRODUCTS if a == asin), f"Produkt {asin}")
        main_cat = random.choice(CATEGORIES)
        second_cat = random.choice([c for c in CATEGORIES if c != main_cat])
        results.append(ProductDetail(
            asin=asin,
            title=title,
            price=round(random.uniform(9.99, 299.99), 2),
            total_revenue=round(random.uniform(1000, 50000), 2),
            blm=round(random.uniform(100, 5000), 2),
            avg_rating=round(random.uniform(3.5, 5.0), 1),
            ratings_count=random.randint(50, 5000),
            main_category=main_cat,
            main_category_rank=random.randint(1, 500),
            second_category=second_cat,
            second_category_rank=random.randint(1, 200),
            manufacturer=random.choice(MANUFACTURERS),
            store=random.choice(MANUFACTURERS) + " Store",
            image_url=f"https://m.media-amazon.com/images/I/placeholder-{asin}.jpg",
            last_scraped=datetime.now(timezone.utc).isoformat(),
        ))
    return results
