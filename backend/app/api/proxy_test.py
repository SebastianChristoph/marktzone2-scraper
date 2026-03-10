"""
Proxy connectivity test endpoint.
Tests raw and Webshare country-format username variants.
"""
import os
import time
import logging
from urllib.parse import urlparse
from fastapi import APIRouter
import requests as req

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/proxy-test", tags=["proxy-test"])

_IP_CHECK_URL = "http://api.ipify.org?format=json"
_AMAZON_CHECK_URL = "http://www.amazon.com/robots.txt"
_TIMEOUT = 15


def _parse_raw_proxy() -> dict | None:
    url = os.getenv("WEBSHARE_PROXY_URL", "")
    if not url:
        return None
    p = urlparse(url)
    return {
        "server": f"{p.scheme}://{p.hostname}:{p.port}",
        "username": p.username,
        "password": p.password,
    }


def _build_proxies(server: str, username: str, password: str) -> dict:
    scheme = server.split("://")[0]
    host_port = server.split("://")[1]
    url = f"{scheme}://{username}:{password}@{host_port}/"
    return {"http": url, "https": url}


def _check_ip(proxies: dict) -> dict:
    t0 = time.monotonic()
    try:
        r = req.get(_IP_CHECK_URL, proxies=proxies, timeout=_TIMEOUT)
        ms = round((time.monotonic() - t0) * 1000)
        if r.status_code == 407:
            return {"ip": None, "ms": ms, "status_code": 407, "error": "407 Proxy Authentication Required"}
        if r.status_code != 200:
            return {"ip": None, "ms": ms, "status_code": r.status_code, "error": f"HTTP {r.status_code}"}
        return {"ip": r.json().get("ip"), "ms": ms, "status_code": 200, "error": None}
    except Exception as e:
        return {"ip": None, "ms": None, "status_code": None, "error": str(e)}


def _check_amazon(proxies: dict) -> dict:
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"}
    t0 = time.monotonic()
    try:
        r = req.get(_AMAZON_CHECK_URL, proxies=proxies, headers=headers, timeout=_TIMEOUT, allow_redirects=True)
        ms = round((time.monotonic() - t0) * 1000)
        body = r.text.lower()
        blocked = r.status_code in (403, 503) or "captcha" in body or "robot check" in body
        return {"status_code": r.status_code, "ms": ms, "blocked": blocked, "error": None}
    except Exception as e:
        return {"status_code": None, "ms": None, "blocked": False, "error": str(e)}


def _run_variant(server: str, username: str, password: str, direct_ip: str | None) -> dict:
    proxies = _build_proxies(server, username, password)
    ip = _check_ip(proxies)
    amazon = _check_amazon(proxies)
    ip_ok = ip["ip"] is not None and ip["ip"] != direct_ip
    amz_ok = amazon["status_code"] is not None and amazon["status_code"] != 407 and not amazon["blocked"]
    return {
        "username": username,
        "ip_result": ip,
        "amazon_result": amazon,
        "proxy_working": ip_ok,
        "amazon_ok": amz_ok,
    }


@router.get("")
async def run_proxy_test() -> dict:
    raw = _parse_raw_proxy()

    # Direct IP (no proxy)
    direct_ip: str | None = None
    try:
        r = req.get(_IP_CHECK_URL, timeout=_TIMEOUT)
        direct_ip = r.json().get("ip")
    except Exception as e:
        logger.warning(f"[ProxyTest] Direct IP failed: {e}")

    if not raw:
        return {"proxy_configured": False, "direct_ip": direct_ip, "variants": [], "error": "WEBSHARE_PROXY_URL not set"}

    server = raw["server"]
    base_user = raw["username"]  # e.g. "nbbbwudu-1"
    password = raw["password"]

    # Build variants to test
    parts = base_user.rsplit("-", 1)
    country_user_upper = f"{parts[0]}-US-{parts[1]}" if len(parts) == 2 else f"{base_user}-US"  # nbbbwudu-US-1
    country_user_lower = f"{parts[0]}-us-{parts[1]}" if len(parts) == 2 else f"{base_user}-us"  # nbbbwudu-us-1

    variants = [
        _run_variant(server, base_user, password, direct_ip),              # raw
        _run_variant(server, country_user_upper, password, direct_ip),     # nbbbwudu-US-1 (uppercase)
        _run_variant(server, country_user_lower, password, direct_ip),     # nbbbwudu-us-1 (lowercase)
    ]

    return {
        "proxy_configured": True,
        "proxy_server": server,
        "direct_ip": direct_ip,
        "variants": variants,
    }
