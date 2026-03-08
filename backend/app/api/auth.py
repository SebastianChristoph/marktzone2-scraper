import os
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])

_PASSWORD = os.getenv("APP_PASSWORD", "")


class VerifyRequest(BaseModel):
    password: str


@router.post("/verify")
def verify(request: VerifyRequest) -> dict:
    if not _PASSWORD:
        return {"ok": True}  # no password configured = open
    return {"ok": request.password == _PASSWORD}
