import logging
import os
from urllib.parse import urlparse
from typing import Optional

logger = logging.getLogger(__name__)

# Set WEBSHARE_PROXY_URL=http://user:pass@host:port in .env
_PROXY_URL = os.getenv("WEBSHARE_PROXY_URL", "")
_parsed_base: Optional[object] = None
_initialized = False

# Webshare country code mapping
COUNTRY_CODES = {"us": "us", "de": "de", "fr": "fr"}


def _init() -> None:
    global _parsed_base, _initialized
    if _initialized:
        return
    _initialized = True

    if not _PROXY_URL:
        logger.info("[Proxy] WEBSHARE_PROXY_URL not set — running without proxy")
        return

    try:
        _parsed_base = urlparse(_PROXY_URL)
        logger.info(f"[Proxy] Configured proxy: {_parsed_base.scheme}://{_parsed_base.hostname}:{_parsed_base.port} (user: {_parsed_base.username})")
    except Exception as e:
        logger.warning(f"[Proxy] Failed to parse WEBSHARE_PROXY_URL: {e} — running without proxy")


def get_proxy(country: Optional[str] = None) -> Optional[dict]:
    """Return the Playwright proxy dict, or None if not configured.
    Pass country='us'/'de'/'fr' to target a specific country via Webshare username suffix.
    """
    _init()
    if _parsed_base is None:
        return None

    effective_country = (country or "us").lower()
    username = _parsed_base.username
    if effective_country in COUNTRY_CODES:
        username = f"{username}-country-{COUNTRY_CODES[effective_country]}"

    return {
        "server": f"{_parsed_base.scheme}://{_parsed_base.hostname}:{_parsed_base.port}",
        "username": username,
        "password": _parsed_base.password,
    }
