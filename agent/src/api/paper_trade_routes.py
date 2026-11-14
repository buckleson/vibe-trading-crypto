"""Authenticated paper-account API; all mutations use the settings write gate."""

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from src.paper_runs import PaperRunNotFound, PaperRuns
from src.api.security import require_auth, require_settings_write_auth
from src.tools.paper_trade.accounts import AccountConflict, PaperAccounts


class CreateAccount(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=80)
    market: str
    account_state: dict
    start: str = "today"
    fee_model: dict = Field(default_factory=dict)


class AdvanceAccount(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(strict=True, ge=0)
    to_date: str
    orders: list[dict] | None = Field(default=None, max_length=1000)
    strategy_path: str | None = None


class CreatePaperRun(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str = Field(min_length=1, max_length=200)
    label: str | None = Field(default=None, max_length=80)
    initial_cash: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    warmup_days: int | None = Field(default=None, ge=1, le=5000)


def _run_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except PaperRunNotFound as exc:
        raise HTTPException(404, "Paper run not found") from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except KeyError as exc:
        raise HTTPException(404, "Paper account not found") from exc
    except AccountConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def register_paper_trade_routes(app: FastAPI):
    @app.get("/api/paper-accounts", dependencies=[Depends(require_auth)])
    def list_accounts():
        return PaperAccounts().list()

    @app.post(
        "/api/paper-accounts", dependencies=[Depends(require_settings_write_auth)]
    )
    def create_account(body: CreateAccount):
        return _call(PaperAccounts().create, **body.model_dump())

    @app.get("/api/paper-accounts/{account_id}", dependencies=[Depends(require_auth)])
    def get_account(account_id: str):
        return _call(PaperAccounts().get, account_id)

    @app.get(
        "/api/paper-accounts/{account_id}/history", dependencies=[Depends(require_auth)]
    )
    def account_history(account_id: str):
        return _call(PaperAccounts().history, account_id)

    @app.post(
        "/api/paper-accounts/{account_id}/advance",
        dependencies=[Depends(require_settings_write_auth)],
    )
    def advance_account(account_id: str, body: AdvanceAccount):
        return _call(PaperAccounts().advance, account_id, **body.model_dump())

    @app.post(
        "/api/paper-trade/step", dependencies=[Depends(require_settings_write_auth)]
    )
    def pure_step(body: dict):
        import json
        from src.tools.paper_trade.tool import run_paper_trade_step

        return json.loads(run_paper_trade_step(body))

    @app.get("/api/paper-runs", dependencies=[Depends(require_auth)])
    def list_paper_runs():
        return PaperRuns().list()

    @app.post("/api/paper-runs", dependencies=[Depends(require_settings_write_auth)])
    def create_paper_run(body: CreatePaperRun):
        return _run_call(PaperRuns().create, **body.model_dump())

    @app.get("/api/paper-runs/{paper_id}", dependencies=[Depends(require_auth)])
    def get_paper_run(paper_id: str):
        return _run_call(PaperRuns().detail, paper_id)

    @app.post(
        "/api/paper-runs/{paper_id}/refresh",
        dependencies=[Depends(require_settings_write_auth)],
    )
    def refresh_paper_run(paper_id: str):
        return _run_call(PaperRuns().refresh, paper_id)

    @app.post(
        "/api/paper-runs/{paper_id}/stop",
        dependencies=[Depends(require_settings_write_auth)],
    )
    def stop_paper_run(paper_id: str):
        return _run_call(PaperRuns().stop, paper_id)

    @app.delete(
        "/api/paper-runs/{paper_id}",
        dependencies=[Depends(require_settings_write_auth)],
    )
    def delete_paper_run(paper_id: str):
        _run_call(PaperRuns().delete, paper_id)
        return {"deleted": True}
