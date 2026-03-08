from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.db.error_log import get_errors, delete_error, delete_all_errors, count_last_24h
from app.db.paths import SCREENSHOTS_DIR

router = APIRouter(prefix="/logs", tags=["logs"])


class ErrorEntry(BaseModel):
    id: int
    timestamp: str
    scraper_type: str
    job_id: Optional[str]
    context: str
    url: Optional[str]
    error_type: str
    error_message: Optional[str]
    attempt: Optional[int]
    screenshot_file: Optional[str]


class LogsResponse(BaseModel):
    errors: list[ErrorEntry]
    count_24h: int


@router.get("", response_model=LogsResponse)
async def list_errors(
    limit: int = Query(default=200, le=1000),
    scraper_type: Optional[str] = Query(default=None),
    error_type: Optional[str] = Query(default=None),
) -> LogsResponse:
    errors = get_errors(limit=limit, scraper_type=scraper_type, error_type=error_type)
    return LogsResponse(
        errors=[ErrorEntry(**e) for e in errors],
        count_24h=count_last_24h(),
    )


@router.delete("/all")
async def clear_all() -> dict:
    n = delete_all_errors()
    return {"deleted": n}


@router.delete("/screenshots")
async def delete_all_screenshots() -> dict:
    deleted = 0
    for f in SCREENSHOTS_DIR.glob("*.png"):
        try:
            f.unlink()
            deleted += 1
        except Exception:
            pass
    return {"deleted": deleted}


@router.delete("/{error_id}")
async def delete_one(error_id: int) -> dict:
    if not delete_error(error_id):
        raise HTTPException(status_code=404, detail="Error entry not found")
    return {"deleted": error_id}
