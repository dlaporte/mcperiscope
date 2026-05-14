"""Per-startup bearer token for guarding /api routes.

Generates a fresh token on every backend startup and persists it to
~/.mcperiscope/token with mode 0600 so the frontend (and the user) can
read it from a known location.
"""

from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path

from fastapi import Header, HTTPException, status

logger = logging.getLogger(__name__)


_TOKEN: str | None = None
_TOKEN_PATH = Path.home() / ".mcperiscope" / "token"


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        logger.debug("Could not chmod %s to 0700", path, exc_info=True)


def _write_token_file(path: Path, token: str) -> None:
    _ensure_dir(path.parent)
    # Atomically write with 0600.
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(token)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        logger.debug("Could not chmod %s to 0600", path, exc_info=True)


def init_token() -> str:
    """Generate the per-startup token and persist it. Returns the token."""
    global _TOKEN
    _TOKEN = secrets.token_urlsafe(32)
    try:
        _write_token_file(_TOKEN_PATH, _TOKEN)
    except OSError as e:
        logger.warning("Could not write token file %s: %s", _TOKEN_PATH, e)
    return _TOKEN


def get_token() -> str | None:
    return _TOKEN


def token_path() -> Path:
    return _TOKEN_PATH


def require_token(authorization: str | None = Header(default=None)) -> None:
    """FastAPI dependency that gates /api on the per-startup bearer token.

    Set MCPERISCOPE_DISABLE_AUTH=1 to skip auth (testing only).
    """
    if os.environ.get("MCPERISCOPE_DISABLE_AUTH") == "1":
        return
    expected = _TOKEN
    if not expected:
        # Token not yet initialised — fail closed.
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="auth not ready")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    supplied = authorization[len("Bearer "):].strip()
    if not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid bearer token")
