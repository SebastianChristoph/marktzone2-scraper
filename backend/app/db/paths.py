"""
Central data directory for all persistent files (SQLite DBs, screenshots).
Override with SCRAPER_DATA_DIR env var — set to /app/data in Docker.
"""
import os
from pathlib import Path

DATA_DIR = Path(os.getenv("SCRAPER_DATA_DIR", str(Path(__file__).parent.parent.parent)))
DATA_DIR.mkdir(parents=True, exist_ok=True)

SCREENSHOTS_DIR = DATA_DIR / "screenshots"
SCREENSHOTS_DIR.mkdir(exist_ok=True)
