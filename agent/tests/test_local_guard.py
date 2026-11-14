"""Local request guard (ADR 0002): no login, but only this computer may call the API."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import api_server

GUARDED = "/skills"  # read-only route behind require_auth
GUARDED_WRITE = "/api/paper-accounts"  # empty body fails validation, creates nothing


def _local() -> TestClient:
    return TestClient(api_server.app, client=("127.0.0.1", 50000))


def _remote() -> TestClient:
    return TestClient(api_server.app, client=("203.0.113.7", 50000))


def test_loopback_get_needs_no_credentials() -> None:
    assert _local().get(GUARDED).status_code == 200


def test_non_loopback_client_is_rejected() -> None:
    response = _remote().get(GUARDED)
    assert response.status_code == 403
    assert response.json()["detail"] == "Vibe Crypto only accepts requests from this computer"


def test_cross_site_origin_write_is_rejected() -> None:
    response = _local().post(GUARDED_WRITE, json={}, headers={"Origin": "https://evil.example"})
    assert response.status_code == 403
    assert response.json()["detail"] == "Cross-site request denied"


@pytest.mark.parametrize("headers", [{}, {"Origin": "http://127.0.0.1:5173"}])
def test_write_without_or_with_loopback_origin_passes_guard(headers: dict[str, str]) -> None:
    response = _local().post(GUARDED_WRITE, json={}, headers=headers)
    assert response.status_code not in {401, 403}


def test_sse_ticket_route_is_gone() -> None:
    assert _local().post("/auth/sse-ticket").status_code in {404, 405}


def test_rebound_host_header_is_rejected() -> None:
    response = _local().get(GUARDED, headers={"Host": "evil.example"})
    assert response.status_code == 403


def test_api_auth_key_env_has_no_effect(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_AUTH_KEY", "anything")
    assert _local().get(GUARDED).status_code == 200
