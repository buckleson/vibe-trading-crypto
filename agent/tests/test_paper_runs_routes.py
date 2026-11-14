"""REST routes for paper runs with a mocked backtest."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api_server import app
from tests.test_paper_runs import Fake, make_source


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_TRADING_HOME", str(tmp_path))
    make_source(tmp_path / "runs")
    import src.paper_runs.service as svc

    fake = Fake()
    monkeypatch.setattr(svc, "_run_backtest", fake)
    return TestClient(app, raise_server_exceptions=False)


def test_full_lifecycle(client):
    assert client.get("/api/paper-runs").json() == []
    r = client.post("/api/paper-runs", json={"run_id": "src1", "label": "mine"})
    assert r.status_code == 200, r.text
    doc = r.json()
    pid = doc["id"]
    assert doc["state"] == "waiting" and doc["label"] == "mine"
    assert [d["id"] for d in client.get("/api/paper-runs").json()] == [pid]

    d = client.get(f"/api/paper-runs/{pid}").json()
    assert d["equity"] == [] and d["run"]["id"] == pid

    d = client.post(f"/api/paper-runs/{pid}/refresh").json()
    assert d["run"]["state"] == "ok" and len(d["equity"]) == 5 and d["run"]["summary"]["bars"] == 5

    d = client.post(f"/api/paper-runs/{pid}/stop").json()
    assert d["run"]["status"] == "stopped"

    assert client.delete(f"/api/paper-runs/{pid}").json() == {"deleted": True}
    assert client.get(f"/api/paper-runs/{pid}").status_code == 404


def test_not_found_and_validation(client):
    for method, path in [("get", ""), ("post", "/refresh"), ("post", "/stop"), ("delete", "")]:
        r = getattr(client, method)(f"/api/paper-runs/abcdef123456{path}")
        assert r.status_code == 404 and r.json()["detail"] == "Paper run not found"
    r = client.post("/api/paper-runs", json={"run_id": "missing"})
    assert r.status_code == 422 and "not found" in r.json()["detail"]
    assert client.post("/api/paper-runs", json={"run_id": "src1", "initial_cash": 0}).status_code == 422
    assert client.post("/api/paper-runs", json={"run_id": "src1", "bogus": 1}).status_code == 422
    assert client.post("/api/paper-runs", json={"run_id": "src1", "warmup_days": 0}).status_code == 422
