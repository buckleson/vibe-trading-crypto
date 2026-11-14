"""Claude chat route tests (SDK mocked)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import api_server
from src.claude_chat import service


@pytest.fixture()
def client():
    return TestClient(api_server.app, base_url="http://127.0.0.1:8899")


def test_status_shape(client):
    r = client.get("/api/claude/status")
    assert r.status_code == 200
    assert set(r.json()) == {"available", "sdk_version", "auth", "model", "error"}


def test_chat_streams_events(client, monkeypatch):
    async def fake(message, session_id, model):
        yield {"type": "session", "session_id": "s1"}
        yield {"type": "text", "delta": "Hi"}
        yield {"type": "done", "session_id": "s1", "is_error": False, "cost_usd": None, "duration_ms": 1}

    monkeypatch.setattr(service, "stream_chat", fake)
    r = client.post("/api/claude/chat", json={"message": "hello"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    lines = [ln for ln in r.text.splitlines() if ln.startswith("event:")]
    assert lines == ["event: session", "event: text", "event: done"]


@pytest.mark.parametrize("body", [
    {"message": ""}, {"message": "   "}, {"message": "x", "session_id": "bad id!"}, {"message": "x", "extra": 1},
])
def test_chat_validation(client, body):
    assert client.post("/api/claude/chat", json=body).status_code == 422


def test_cross_site_origin_rejected(client):
    r = client.post("/api/claude/chat", json={"message": "hi"}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
