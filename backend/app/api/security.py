import os
from fastapi import Header, HTTPException

_SECRET = os.getenv("SCRAPER_SECRET", "")


def require_scraper_secret(x_scraper_secret: str = Header(default="")) -> None:
    """Dependency: validates the shared secret sent by marktzone2 backend."""
    if not _SECRET:
        return  # no secret configured = open (local dev)
    if x_scraper_secret != _SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
