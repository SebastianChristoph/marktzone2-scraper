import logging
import os
import random
from urllib.parse import urlparse
from typing import Optional

logger = logging.getLogger(__name__)

# Set WEBSHARE_PROXY_URL=http://user:pass@host:port in .env
_PROXY_URL = os.getenv("WEBSHARE_PROXY_URL", "")
_parsed_base: Optional[object] = None
_initialized = False

# Webshare country code mapping (uppercase, inserted between base and session)
# Format: {base}-{COUNTRY}-{session}  e.g. nbbbwudu-US-3
COUNTRY_CODES = {"us": "US", "de": "DE", "fr": "FR"}

# Number of available sessions per country (as seen in Webshare dashboard)
SESSION_COUNT = {"us": 10, "de": 1, "fr": 1}


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
    Pass country='us'/'de'/'fr' to target a specific exit country.
    Webshare format: base-COUNTRY-session  (e.g. nbbbwudu-US-1)
    No country → raw username (no suffix).
    """
    _init()
    if _parsed_base is None:
        return None

    username = _parsed_base.username  # e.g. "nbbbwudu-1"
    effective_country = (country or "us").lower()

    if effective_country in COUNTRY_CODES:
        # Pick a random session number from the available pool
        max_sessions = SESSION_COUNT.get(effective_country, 1)
        session = random.randint(1, max_sessions)
        parts = username.rsplit("-", 1)
        base = parts[0] if len(parts) == 2 else username
        username = f"{base}-{COUNTRY_CODES[effective_country]}-{session}"
        logger.debug(f"[Proxy] Using session {session}/{max_sessions} for country={effective_country}")

    return {
        "server": f"{_parsed_base.scheme}://{_parsed_base.hostname}:{_parsed_base.port}",
        "username": username,
        "password": _parsed_base.password,
    }
