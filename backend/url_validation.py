"""URL validation for user-supplied MCP and LLM endpoints.

Closes the SSRF foot-gun on /api/connect (req.url) and on any place that
takes a custom_endpoint to point an OpenAI-compatible client at. We:

  * Reject schemes other than http / https (no file://, data://, gopher://…).
  * Block link-local / multicast / unspecified / reserved addresses — those
    are basically never a legitimate target and link-local in particular is
    the cloud-metadata service path.
  * Allow loopback and private (RFC-1918 / RFC-4193) addresses. This is a
    local developer tool; pointing at homelab / LAN services is the norm.

Hostname-based targets that resolve to a blocked range are caught via a
best-effort DNS lookup first.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
from urllib.parse import urlparse

from fastapi import HTTPException

logger = logging.getLogger(__name__)

_ALLOWED_SCHEMES = {"http", "https"}


def _ip_is_blocked(ip: ipaddress._BaseAddress) -> str | None:
    """Return a reason string if this IP must be rejected, else None."""
    if ip.is_unspecified:
        return "unspecified address"
    if ip.is_multicast:
        return "multicast address"
    if ip.is_reserved:
        return "reserved address"
    if ip.is_link_local:
        return "link-local address"
    return None


def _resolve(host: str) -> list[ipaddress._BaseAddress]:
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return []
    out: list[ipaddress._BaseAddress] = []
    for info in infos:
        addr = info[4][0]
        try:
            out.append(ipaddress.ip_address(addr))
        except ValueError:
            continue
    return out


def validate_external_url(url: str | None, *, label: str = "URL") -> None:
    """Raise HTTPException(400) if url is unsafe for the backend to fetch."""
    if not url:
        raise HTTPException(status_code=400, detail=f"{label} is required")
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail=f"{label} is not a valid URL")
    scheme = (parsed.scheme or "").lower()
    if scheme not in _ALLOWED_SCHEMES:
        raise HTTPException(
            status_code=400,
            detail=f"{label} must use http or https (got {scheme!r})",
        )
    host = parsed.hostname
    if not host:
        raise HTTPException(status_code=400, detail=f"{label} has no host")

    # If the host is a literal IP, check directly.
    try:
        ip = ipaddress.ip_address(host)
        reason = _ip_is_blocked(ip)
        if reason:
            raise HTTPException(status_code=400, detail=f"{label}: {reason}")
        return
    except ValueError:
        pass

    # Hostname: resolve and check every result. If resolution fails, let the
    # upstream HTTP client raise — we don't want DNS hiccups to mask legit URLs.
    addrs = _resolve(host)
    for addr in addrs:
        reason = _ip_is_blocked(addr)
        if reason:
            raise HTTPException(
                status_code=400,
                detail=f"{label}: host {host!r} resolves to {addr} — {reason}",
            )
