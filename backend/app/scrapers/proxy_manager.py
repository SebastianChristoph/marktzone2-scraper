import logging
import os
from urllib.parse import urlparse
from typing import Optional

logger = logging.getLogger(__name__)

# Set WEBSHARE_PROXY_URL=http://user:pass@host:port in .env
_PROXY_URL = os.getenv("WEBSHARE_PROXY_URL", "")
_proxy: Optional[dict] = None
_initialized = False


def _init() -> None:
    global _proxy, _initialized
    if _initialized:
        return
    _initialized = True

    if not _PROXY_URL:
        logger.info("[Proxy] WEBSHARE_PROXY_URL not set — running without proxy")
        return

    try:
        parsed = urlparse(_PROXY_URL)
        _proxy = {
            "server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}",
            "username": parsed.username,
            "password": parsed.password,
        }
        logger.info(f"[Proxy] Configured proxy: {parsed.scheme}://{parsed.hostname}:{parsed.port} (user: {parsed.username})")
    except Exception as e:
        logger.warning(f"[Proxy] Failed to parse WEBSHARE_PROXY_URL: {e} — running without proxy")


def get_proxy() -> Optional[dict]:
    """Return the Playwright proxy dict, or None if not configured."""
    _init()
    return _proxy
