"""
Scraper performance statistics.
Aggregates data from all persisted jobs in the DB.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from app.db.job_store import load_all_jobs

router = APIRouter(prefix="/stats", tags=["stats"])


def _percentile(sorted_data: list[float], p: float) -> float:
    if not sorted_data:
        return 0.0
    idx = min(int(len(sorted_data) * p), len(sorted_data) - 1)
    return sorted_data[idx]


def _timing_stats(values: list[float]) -> dict:
    if not values:
        return {"avg": None, "p50": None, "p95": None, "p99": None, "min": None, "max": None}
    s = sorted(values)
    return {
        "avg": round(sum(s) / len(s), 2),
        "p50": round(_percentile(s, 0.50), 2),
        "p95": round(_percentile(s, 0.95), 2),
        "p99": round(_percentile(s, 0.99), 2),
        "min": round(s[0], 2),
        "max": round(s[-1], 2),
    }


@router.get("")
async def get_stats() -> dict:
    jobs = load_all_jobs()

    total_jobs = len(jobs)
    completed_jobs = sum(1 for j in jobs if j["status"] == "completed")
    failed_jobs = sum(1 for j in jobs if j["status"] == "failed")

    total_markets_attempted = 0
    total_markets_scraped = 0
    total_asins_scraped = 0
    total_errors = 0

    job_durations: list[float] = []
    phase1_durations: list[float] = []
    phase2_durations: list[float] = []
    asin_durations: list[float] = []

    cluster_map: dict[int, dict] = {}

    for job in jobs:
        total_markets_attempted += len(job.get("markets", []))
        results = job.get("results") or []
        total_markets_scraped += len(results)
        for r in results:
            total_asins_scraped += len(r.get("products", []))
        total_errors += len(job.get("errors", []))

        timing = job.get("timing") or {}
        if timing.get("total_duration_s"):
            job_durations.append(timing["total_duration_s"])

        for _mname, mt in (timing.get("markets") or {}).items():
            if mt.get("phase1_duration_s"):
                phase1_durations.append(mt["phase1_duration_s"])
            if mt.get("phase2_duration_s"):
                phase2_durations.append(mt["phase2_duration_s"])
            for d in mt.get("asin_durations_s") or []:
                asin_durations.append(d)

        cid = job.get("cluster_id", 0)
        if cid not in cluster_map:
            cluster_map[cid] = {"cluster_id": cid, "job_count": 0, "total_asins": 0, "completed": 0, "failed": 0}
        cluster_map[cid]["job_count"] += 1
        cluster_map[cid]["total_asins"] += sum(len(r.get("products", [])) for r in results)
        if job["status"] == "completed":
            cluster_map[cid]["completed"] += 1
        elif job["status"] == "failed":
            cluster_map[cid]["failed"] += 1

    # Jobs per day — last 30 days
    today = datetime.now(timezone.utc).date()
    days_map: dict[str, int] = {
        str(today - timedelta(days=i)): 0 for i in range(29, -1, -1)
    }
    for job in jobs:
        d = (job.get("created_at") or "")[:10]
        if d in days_map:
            days_map[d] += 1
    jobs_per_day = [{"date": d, "count": c} for d, c in days_map.items()]

    # ASIN duration histogram buckets (0-1s, 1-2s, 2-3s, 3-5s, 5-10s, >10s)
    buckets = {"0-1s": 0, "1-2s": 0, "2-3s": 0, "3-5s": 0, "5-10s": 0, ">10s": 0}
    for d in asin_durations:
        if d < 1:
            buckets["0-1s"] += 1
        elif d < 2:
            buckets["1-2s"] += 1
        elif d < 3:
            buckets["2-3s"] += 1
        elif d < 5:
            buckets["3-5s"] += 1
        elif d < 10:
            buckets["5-10s"] += 1
        else:
            buckets[">10s"] += 1
    asin_histogram = [{"bucket": k, "count": v} for k, v in buckets.items()]

    top_clusters = sorted(cluster_map.values(), key=lambda x: x["job_count"], reverse=True)[:10]

    # Estimated throughput: ASINs per hour based on avg asin duration and semaphore=4
    asin_avg = (_timing_stats(asin_durations)["avg"] or 0)
    throughput_per_hour = round((3600 / asin_avg) * 4, 0) if asin_avg > 0 else None

    return {
        "summary": {
            "total_jobs": total_jobs,
            "completed_jobs": completed_jobs,
            "failed_jobs": failed_jobs,
            "success_rate": round(completed_jobs / total_jobs, 3) if total_jobs > 0 else 0,
            "total_markets_attempted": total_markets_attempted,
            "total_markets_scraped": total_markets_scraped,
            "total_asins_scraped": total_asins_scraped,
            "total_errors": total_errors,
        },
        "timing": {
            "job_duration": _timing_stats(job_durations),
            "phase1_per_market": _timing_stats(phase1_durations),
            "phase2_per_market": _timing_stats(phase2_durations),
            "asin": _timing_stats(asin_durations),
            "estimated_asins_per_hour": throughput_per_hour,
        },
        "jobs_per_day": jobs_per_day,
        "asin_histogram": asin_histogram,
        "top_clusters": top_clusters,
    }
