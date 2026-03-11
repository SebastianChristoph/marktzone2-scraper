import threading
import time

_lock = threading.Lock()
_tripped_at: float | None = None
RECOVERY_WAIT_S = 45  # seconds to wait before retrying after tunnel failure


def trip():
    """Mark the proxy tunnel as down."""
    global _tripped_at
    with _lock:
        if _tripped_at is None:
            _tripped_at = time.monotonic()


def wait_if_tripped():
    """Block until the circuit breaker resets (tunnel assumed recovered)."""
    while True:
        with _lock:
            if _tripped_at is None:
                return
            elapsed = time.monotonic() - _tripped_at
            if elapsed >= RECOVERY_WAIT_S:
                _tripped_at = None
                return
            remaining = RECOVERY_WAIT_S - elapsed
        time.sleep(min(remaining, 2))


def reset():
    """Reset circuit breaker after a successful scrape."""
    global _tripped_at
    with _lock:
        _tripped_at = None
