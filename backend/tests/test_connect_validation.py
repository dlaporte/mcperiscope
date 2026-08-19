"""Tests for /connect auth-config validation."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.models import AuthConfig
from backend.routes.connection import _validate_auth_config


def test_none_passes():
    _validate_auth_config(None)
    _validate_auth_config(AuthConfig(type="none"))


def test_client_creds_requires_all_fields():
    for partial in (
        {},
        {"token_endpoint": "https://127.0.0.1/token"},
        {"token_endpoint": "https://127.0.0.1/token", "client_id": "c"},
        {"client_id": "c", "client_secret": "s"},
    ):
        with pytest.raises(HTTPException) as exc:
            _validate_auth_config(AuthConfig(type="oauth_client_creds", **partial))
        assert exc.value.status_code == 400


def test_client_creds_valid():
    _validate_auth_config(
        AuthConfig(
            type="oauth_client_creds",
            token_endpoint="https://127.0.0.1/token",
            client_id="c",
            client_secret="s",
        )
    )


def test_client_creds_token_endpoint_must_be_valid_url():
    with pytest.raises(HTTPException) as exc:
        _validate_auth_config(
            AuthConfig(
                type="oauth_client_creds",
                token_endpoint="ftp://127.0.0.1/token",
                client_id="c",
                client_secret="s",
            )
        )
    assert exc.value.status_code == 400


def test_cimd_requires_https():
    with pytest.raises(HTTPException) as exc:
        _validate_auth_config(
            AuthConfig(type="oauth", client_metadata_url="http://127.0.0.1/client.json")
        )
    assert exc.value.status_code == 400
    assert "HTTPS" in exc.value.detail


def test_cimd_rejects_root_path():
    for url in ("https://127.0.0.1", "https://127.0.0.1/"):
        with pytest.raises(HTTPException) as exc:
            _validate_auth_config(AuthConfig(type="oauth", client_metadata_url=url))
        assert exc.value.status_code == 400


def test_cimd_valid():
    _validate_auth_config(
        AuthConfig(type="oauth", client_metadata_url="https://127.0.0.1/oauth/client.json")
    )


def test_oauth_optional_fields_pass():
    _validate_auth_config(
        AuthConfig(type="oauth", scope="openid", client_id="c", client_secret="s")
    )
