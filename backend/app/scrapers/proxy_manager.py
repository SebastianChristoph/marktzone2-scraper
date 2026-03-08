import logging
import os
import random
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# Webshare proxy list download URL — set via WEBSHARE_PROXY_LIST_URL env var
_PROXY_LIST_URL = os.getenv("WEBSHARE_PROXY_LIST_URL", "")

_proxies: list[dict] = []
_loaded = False


def _load_proxies() -> None:
    global _proxies, _loaded
    if _loaded:
        return
    _loaded = True

    if not _PROXY_LIST_URL:
        logger.info("[Proxy] WEBSHARE_PROXY_LIST_URL not set — running without proxies")
        return

    try:
        resp = requests.get(_PROXY_LIST_URL, timeout=15)
        resp.raise_for_status()
        lines = [l.strip() for l in resp.text.splitlines() if l.strip()]
        parsed = []
        for line in lines:
            parts = line.split(":")
            if len(parts) == 4:
                host, port, username, password = parts
                parsed.append({
                    "server": f"http://{host}:{port}",
                    "username": username,
                    "password": password,
                })
        _proxies = parsed
        logger.info(f"[Proxy] Loaded {len(_proxies)} proxies from Webshare")
    except Exception as e:
        logger.warning(f"[Proxy] Failed to load proxy list: {e} — running without proxies")


def get_proxy() -> Optional[dict]:
    """Return a random proxy dict for Playwright, or None if no proxies available."""
    _load_proxies()
    if not _proxies:
        return None
    return random.choice(_proxies)
