"""
DC proxy connectivity test endpoint.
Tests the configured DC_PROXY_LIST proxies: IP routing + Amazon reachability.
"""
import os
import time
import random
import logging
from fastapi import APIRouter
import requests as req

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/proxy-test", tags=["proxy-test"])

_IP_CHECK_URL = "http://api.ipify.org?format=json"
_AMAZON_CHECK_URL = "http://www.amazon.com/robots.txt"
_TIMEOUT = 15


def _check_proxy(proxy_url: str, direct_ip: str | None) -> dict:
    proxies = {"http": proxy_url, "https": proxy_url}
    host = proxy_url.split("@")[-1] if "@" in proxy_url else proxy_url

    t0 = time.monotonic()
    try:
        r = req.get(_IP_CHECK_URL, proxies=proxies, timeout=_TIMEOUT)
        ms_ip = round((time.monotonic() - t0) * 1000)
        exit_ip = r.json().get("ip") if r.status_code == 200 else None
        ip_error = None if r.status_code == 200 else f"HTTP {r.status_code}"
    except Exception as e:
        exit_ip = None
        ip_error = str(e)
        ms_ip = None

    t1 = time.monotonic()
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        r2 = req.get(_AMAZON_CHECK_URL, proxies=proxies, headers=headers, timeout=_TIMEOUT, allow_redirects=True)
        ms_amz = round((time.monotonic() - t1) * 1000)
        body = r2.text.lower()
        amz_blocked = r2.status_code in (403, 503) or "captcha" in body or "robot check" in body
        amz_status = r2.status_code
        amz_error = None
    except Exception as e:
        ms_amz = None
        amz_status = None
        amz_blocked = False
        amz_error = str(e)

    proxy_routing = exit_ip is not None and exit_ip != direct_ip
    amazon_ok = amz_status is not None and not amz_blocked

    return {
        "proxy": host,
        "exit_ip": exit_ip,
        "ip_error": ip_error,
        "ip_ms": ms_ip,
        "proxy_routing": proxy_routing,
        "amazon_status": amz_status,
        "amazon_ok": amazon_ok,
        "amazon_ms": ms_amz,
        "amazon_error": amz_error,
        "ok": proxy_routing and amazon_ok,
    }


@router.get("")
async def run_proxy_test() -> dict:
    dc_list_raw = os.getenv("DC_PROXY_LIST", "").strip()

    # Direct IP
    direct_ip: str | None = None
    try:
        r = req.get(_IP_CHECK_URL, timeout=_TIMEOUT)
        direct_ip = r.json().get("ip")
    except Exception as e:
        logger.warning(f"[ProxyTest] Direct IP failed: {e}")

    if not dc_list_raw:
        return {
            "proxy_configured": False,
            "direct_ip": direct_ip,
            "results": [],
            "error": "DC_PROXY_LIST not set",
        }

    all_proxies = [p.strip() for p in dc_list_raw.split(",") if p.strip()]
    # Sample up to 3 random proxies to check pool health
    sample = random.sample(all_proxies, min(3, len(all_proxies)))

    results = [_check_proxy(p, direct_ip) for p in sample]

    return {
        "proxy_configured": True,
        "proxy_count": len(all_proxies),
        "direct_ip": direct_ip,
        "results": results,
        "all_ok": all(r["ok"] for r in results),
    }
