"""Credential binding utilities.

A stored API key is only safe to reuse against the (provider, endpoint) tuple
under which it was originally supplied. Sending it elsewhere lets a caller
who can reach the backend exfiltrate the key to an attacker-controlled host.

Semantics for each field:
  * Python `None`  → field omitted by the caller. Preserve whatever was set
    last time the key was bound. **Never** treat `None` as "explicit clear",
    or we'll wipe a perfectly valid stored key just because the caller didn't
    re-send every field on every request.
  * ``""``         → caller explicitly cleared it (e.g. switching from a
    custom OpenAI-compatible endpoint back to a stock provider).
  * Non-empty str  → caller wants this exact value.
"""

from __future__ import annotations

from fastapi import HTTPException


def _strip(s: str | None) -> str | None:
    if s is None:
        return None
    return s.strip()


def bind_primary_credentials(
    session,
    *,
    api_key: str | None,
    provider: str | None,
    custom_endpoint: str | None,
    model: str | None,
) -> None:
    """Apply primary (agent) LLM credentials with provider+endpoint atomicity.

    Rules:
      1. If ``api_key`` is supplied, replace the stored key together with the
         supplied (provider, endpoint). Any field the caller left as ``None``
         keeps its current session value — but the binding to provider+
         endpoint is refreshed against whatever ends up in the session.
      2. If ``api_key`` is **not** supplied and the caller is steering the
         stored key toward a different (provider, endpoint) tuple, refuse the
         request and clear the stored key so a retry can't accidentally reuse
         it.
      3. If nothing relevant is supplied, the stored values are untouched.
    """
    api_key = _strip(api_key)
    provider = _strip(provider)
    custom_endpoint = _strip(custom_endpoint)
    if model:
        session.model = model

    if api_key:
        # Atomic rebind. None means "use what's already in the session"; the
        # caller is committing this api_key to whatever the resolved tuple is.
        if provider is not None:
            session.provider = provider
        if custom_endpoint is not None:
            session.custom_endpoint = custom_endpoint
        session.api_key = api_key
        session.api_key_provider = session.provider
        session.api_key_endpoint = session.custom_endpoint
        return

    # No api_key supplied. Resolve the intended destination:
    #   * None  → no change to that field (use stored binding)
    #   * ""    → explicit clear
    #   * value → explicit value
    target_provider = session.api_key_provider if provider is None else provider
    target_endpoint = session.api_key_endpoint if custom_endpoint is None else custom_endpoint

    if session.api_key and (
        target_provider != session.api_key_provider
        or target_endpoint != session.api_key_endpoint
    ):
        # Destination change without resubmitting the key. Wipe and reject.
        session.api_key = ""
        session.api_key_provider = ""
        session.api_key_endpoint = ""
        session.provider = target_provider or session.provider
        session.custom_endpoint = target_endpoint or ""
        raise HTTPException(
            status_code=400,
            detail=(
                "API key cannot be reused with a different provider/endpoint. "
                "Resubmit the key together with the new provider and endpoint."
            ),
        )

    # No destination change — quietly mirror any explicit values forward.
    if provider is not None:
        session.provider = provider
    if custom_endpoint is not None:
        session.custom_endpoint = custom_endpoint


def bind_analyst_credentials(
    session,
    *,
    api_key: str | None,
    provider: str | None,
    endpoint: str | None,
    model: str | None,
) -> None:
    """Same as bind_primary_credentials but for the analyst LLM."""
    api_key = _strip(api_key)
    provider = _strip(provider)
    endpoint = _strip(endpoint)
    if model:
        session.analyst_model = model

    if api_key:
        if provider is not None:
            session.analyst_provider = provider
        if endpoint is not None:
            session.analyst_endpoint = endpoint
        session.analyst_api_key = api_key
        session.analyst_api_key_provider = session.analyst_provider
        session.analyst_api_key_endpoint = session.analyst_endpoint
        return

    target_provider = session.analyst_api_key_provider if provider is None else provider
    target_endpoint = session.analyst_api_key_endpoint if endpoint is None else endpoint

    if session.analyst_api_key and (
        target_provider != session.analyst_api_key_provider
        or target_endpoint != session.analyst_api_key_endpoint
    ):
        session.analyst_api_key = ""
        session.analyst_api_key_provider = ""
        session.analyst_api_key_endpoint = ""
        session.analyst_provider = target_provider or session.analyst_provider
        session.analyst_endpoint = target_endpoint or ""
        raise HTTPException(
            status_code=400,
            detail=(
                "Analyst API key cannot be reused with a different provider/endpoint. "
                "Resubmit the key together with the new provider and endpoint."
            ),
        )

    if provider is not None:
        session.analyst_provider = provider
    if endpoint is not None:
        session.analyst_endpoint = endpoint
