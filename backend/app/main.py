import asyncio
import sys
from contextlib import asynccontextmanager

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.auth import router as auth_router
from app.api.health import router as health_router
from app.api.dummy import router as dummy_router
from app.api.jobs import router as jobs_router
from app.api.scraper import router as scraper_router
from app.api.logs import router as logs_router
from app.api.debug import router as debug_router
from app.api.stats import router as stats_router
from app.api.daily import router as daily_router
from app.api.health_monitor import router as health_monitor_router, start_scheduler
from app.api.proxy_test import router as proxy_test_router
from app.api.exploratory import router as exploratory_router
from app.api.jobs import _init_jobs_from_db
from app.scrapers.http_scraper import _init_proxies
from app.db.error_log import init_db
from app.db.job_store import init_db as init_job_db
from app.db.daily_store import init_db as init_daily_db
from app.db.health_store import init_db as init_health_db
from app.db.paths import SCREENSHOTS_DIR

init_db()
init_job_db()
init_daily_db()
init_health_db()
_init_jobs_from_db()
_init_proxies()  # pre-load proxy pool — avoids race condition on first concurrent job


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    yield


app = FastAPI(title="mz-scraper", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static/screenshots", StaticFiles(directory=str(SCREENSHOTS_DIR)), name="screenshots")

app.include_router(auth_router)
app.include_router(health_router)
app.include_router(dummy_router)
app.include_router(jobs_router)
app.include_router(scraper_router)
app.include_router(logs_router)
app.include_router(debug_router)
app.include_router(stats_router)
app.include_router(daily_router)
app.include_router(health_monitor_router)
app.include_router(proxy_test_router)
app.include_router(exploratory_router)
