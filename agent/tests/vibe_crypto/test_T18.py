"""T18 acceptance tests: share guide, Cloud Run scripts (dry-run only), README section.

Offline. The deploy and teardown scripts run with ``--dry-run`` and a fake ``gcloud`` first
on PATH that records any call; no gcloud command is ever executed.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import textwrap
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
GCP = REPO / "deploy" / "gcp"
DEPLOY = GCP / "deploy.sh"
TEARDOWN = GCP / "teardown.sh"
GUIDE = REPO / "guides" / "share-with-friends.md"
README = REPO / "README.md"

CONNECTORS = [
    "alpaca", "robinhood", "ibkr", "etoro", "zerodha", "dhan", "shoonya", "mstock", "futu",
    "tiger", "longbridge", "kis", "toss", "upbit", "trading212", "scalable", "binance", "okx", "mt5",
]
EM_DASH = "—"
EMOJI_RE = re.compile("[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF\U0001F900-\U0001F9FF]")

needs_bash = pytest.mark.skipif(shutil.which("bash") is None, reason="bash not available")


@pytest.fixture()
def fake_gcloud(tmp_path):
    """A gcloud that records any call in a marker file and fails."""
    marker = tmp_path / "gcloud-was-called"
    bindir = tmp_path / "bin"
    bindir.mkdir()
    exe = bindir / "gcloud"
    exe.write_text(f"#!/bin/sh\necho \"$@\" >> '{marker}'\nexit 1\n")
    exe.chmod(exe.stat().st_mode | stat.S_IXUSR)
    env = dict(os.environ)
    env["PATH"] = f"{bindir}{os.pathsep}{env['PATH']}"
    return env, marker


def _run(script: Path, args: list[str], env: dict) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(script), *args], capture_output=True, text=True, env=env, timeout=60)


@needs_bash
@pytest.mark.parametrize("script", [DEPLOY, TEARDOWN], ids=lambda p: p.name)
def test_scripts_parse_and_are_executable(script):
    assert script.is_file()
    assert os.access(script, os.X_OK), "executable bit not set"
    assert subprocess.run(["bash", "-n", str(script)], capture_output=True).returncode == 0


@needs_bash
def test_deploy_dry_run_prints_full_sequence_without_calling_gcloud(fake_gcloud):
    env, marker = fake_gcloud
    res = _run(DEPLOY, ["--dry-run", "--project", "demo-proj", "--region", "europe-west1"], env)
    assert res.returncode == 0, res.stderr
    assert not marker.exists(), "gcloud was invoked during --dry-run"
    out = res.stdout
    for needle in (
        "gcloud services enable",
        "gcloud storage buckets create",
        "gcloud secrets versions access latest",
        "gcloud secrets add-iam-policy-binding",
        "roles/storage.objectUser",
        "gcloud run deploy vibe-crypto-mcp",
        "--min-instances 1",
        "--max-instances 1",
        "--set-secrets VIBE_CRYPTO_MCP_TOKEN=vibe-crypto-mcp-token:latest",
        "mount-path=/home/vibe/.vibe-trading",
        "europe-west1",
        "/mcp",
        "VIBE_CRYPTO_MCP_ENABLE_ORDERS=0",
        "WARNING",
    ):
        assert needle in out, needle
    assert "VIBE_CRYPTO_MCP_ENABLE_ORDERS=1" not in out


@needs_bash
def test_deploy_enable_orders_flag(fake_gcloud):
    env, marker = fake_gcloud
    res = _run(DEPLOY, ["--dry-run", "--project", "demo-proj", "--enable-orders"], env)
    assert res.returncode == 0, res.stderr
    assert "VIBE_CRYPTO_MCP_ENABLE_ORDERS=1" in res.stdout
    assert not marker.exists()


@needs_bash
def test_deploy_dry_run_requires_project(fake_gcloud):
    env, marker = fake_gcloud
    res = _run(DEPLOY, ["--dry-run"], env)
    assert res.returncode != 0
    assert not marker.exists()


@needs_bash
def test_deploy_help_and_unknown_flag(fake_gcloud):
    env, _ = fake_gcloud
    assert "--dry-run" in _run(DEPLOY, ["--help"], env).stdout
    assert _run(DEPLOY, ["--nope"], env).returncode != 0


@needs_bash
def test_teardown_dry_run(fake_gcloud):
    env, marker = fake_gcloud
    res = _run(TEARDOWN, ["--dry-run", "--project", "demo-proj", "--yes", "--delete-data"], env)
    assert res.returncode == 0, res.stderr
    assert "gcloud run services delete" in res.stdout
    assert "gcloud storage rm --recursive gs://demo-proj-vibe-crypto-data" in res.stdout
    assert not marker.exists()


@needs_bash
def test_teardown_keeps_data_and_secret_by_default(fake_gcloud):
    env, marker = fake_gcloud
    res = _run(TEARDOWN, ["--dry-run", "--project", "demo-proj"], env)
    assert res.returncode == 0, res.stderr
    assert "storage rm" not in res.stdout and "secrets delete" not in res.stdout
    assert "Kept:" in res.stdout
    assert not marker.exists()


@pytest.mark.skipif(shutil.which("shellcheck") is None, reason="shellcheck not installed")
@pytest.mark.parametrize("script", [DEPLOY, TEARDOWN], ids=lambda p: p.name)
def test_shellcheck(script):
    res = subprocess.run(["shellcheck", str(script)], capture_output=True, text=True)
    assert res.returncode == 0, res.stdout


def test_dockerfile_contract():
    text = (GCP / "Dockerfile").read_text(encoding="utf-8")
    assert text.startswith("# ")
    for needle in (
        "FROM python:3.12-slim", "uv==", "USER vibe", "--uid 1000", "EXPOSE 8080",
        "vibe-crypto-mcp --transport http --host 0.0.0.0", "VIBE_CRYPTO_MCP_TOKEN",
        "/home/vibe/.vibe-trading",
    ):
        assert needle in text, needle
    assert not (GCP / "requirements.txt").exists(), "requirements.txt is generated by deploy.sh"


def test_gcp_readme_exists_and_warns():
    text = (GCP / "README.md").read_text(encoding="utf-8")
    for needle in ("holds your broker keys", "--dry-run", "teardown.sh", "min-instances", "gcloud run services logs read"):
        assert needle in text or needle.replace("-", " ") in text, needle
    assert EM_DASH not in text and not EMOJI_RE.search(text)


# --------------------------------------------------------------------------- guide

GUIDE_TEXT = GUIDE.read_text(encoding="utf-8") if GUIDE.exists() else ""


def test_guide_exists_with_required_strings():
    assert GUIDE.is_file()
    for needle in (
        "/plugin marketplace add buckleson/vibe-trading-crypto",
        "/plugin install vibe-crypto@vibe-crypto",
        "https://github.com/buckleson/vibe-trading-crypto/releases/latest/download/vibe-crypto-claude-desktop.mcpb",
        "VIBE_CRYPTO_MCP_TOKEN",
        "/<token>/mcp",
        "No authentication",
        "claude mcp add vibe-crypto -- uvx",
        "~/.cursor/mcp.json",
        "claude_desktop_config.json",
        "VIBE_CRYPTO_MCP_ENABLE_ORDERS",
        "kill switch",
        "mandate",
    ):
        assert needle in GUIDE_TEXT, needle


@pytest.mark.parametrize("name", CONNECTORS)
def test_guide_mentions_every_connector(name):
    assert re.search(rf"\|\s*{name}\s*\|", GUIDE_TEXT), name


def test_guide_connector_rows_match_generated_matrix():
    matrix = (REPO / "guides" / "portfolio-and-brokers.md").read_text(encoding="utf-8")
    for name in CONNECTORS:
        row = re.search(rf"\|\s*{name}\s*\|([^\n]*)", GUIDE_TEXT).group(1)
        cells = [c.strip() for c in row.split("|")][:4]  # market, read, paper, live
        has_paper = f"`{name}-paper-trade`" in matrix
        has_live = f"`{name}-live-trade`" in matrix or f"`{name}-live-mcp`" in matrix
        assert (cells[2] == "Yes") == has_paper, (name, "paper")
        assert (cells[3] == "Yes") == has_live, (name, "live")


def test_guide_relative_links_resolve():
    text = re.sub(r"```.*?```", "", GUIDE_TEXT, flags=re.S)
    for href in re.findall(r"\]\(([^)\s]+)\)", text):
        if re.match(r"^(https?:|mailto:|#)", href):
            continue
        assert (GUIDE.parent / href.split("#", 1)[0]).resolve().exists(), href


def test_guide_style():
    assert EM_DASH not in GUIDE_TEXT
    assert not EMOJI_RE.search(GUIDE_TEXT)


def test_readme_has_share_with_friends_section():
    text = README.read_text(encoding="utf-8")
    assert re.search(r"^## Share with friends$", text, flags=re.M)
    body = text.split("## Share with friends", 1)[1].split("\n## ", 1)[0]
    assert "guides/share-with-friends.md" in body
    assert text.index("## Use with Claude") < text.index("## Share with friends") < text.index("## Paper trading")


# =========================================================================== test-engineer additions
#
# Everything below stays offline. "Mocked real mode" runs deploy.sh / teardown.sh WITHOUT
# --dry-run against a fake gcloud that is first on PATH (asserted before each run) and only
# answers canned values, so the non-dry-run branches are exercised without touching GCP.

import hashlib  # noqa: E402
import json  # noqa: E402
import shlex  # noqa: E402
import socket  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402

AGENT = REPO / "agent"
FAKE_URL = "https://vibe-crypto-mcp-abc-ew.a.run.app"
FAKE_EXISTING_TOKEN = "existing_token_ABCDEFGHIJKLMNOP"
FAKE_PROJECT_NUMBER = "123456789"
TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{16,256}")
CANON = "uvx --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp"

FAKE_GCLOUD_SH = r"""#!/bin/sh
d="$FAKE_GCLOUD_DIR"
printf '%s\n' "$*" >> "$d/calls.log"
if [ -n "${FAKE_GCLOUD_FAIL_ON:-}" ]; then
  case "$*" in *"$FAKE_GCLOUD_FAIL_ON"*) echo "fake gcloud failure" >&2; exit 1 ;; esac
fi
case "$*" in
  "config get-value project"*) printf '%s\n' "${FAKE_PROJECT:-}"; exit 0 ;;
  "storage buckets describe"*) exit "${FAKE_BUCKET_RC:-1}" ;;
  "secrets describe"*) exit "${FAKE_SECRET_RC:-1}" ;;
  "secrets versions access"*) printf '%s\n' "__EXISTING__"; exit 0 ;;
  "secrets create"*) cat > "$d/secret-stdin"; exit 0 ;;
  "projects describe"*) echo __PNUM__; exit 0 ;;
  "run services describe"*) echo __URL__; exit 0 ;;
  "run deploy"*)
    prev=""
    for a in "$@"; do
      if [ "$prev" = "--source" ]; then cp -R "$a" "$d/source-snapshot"; printf '%s' "$a" > "$d/source-path"; fi
      prev="$a"
    done
    for a in "$@"; do printf '%s\n' "$a"; done > "$d/deploy-args"
    exit 0 ;;
esac
exit 0
""".replace("__EXISTING__", FAKE_EXISTING_TOKEN).replace("__PNUM__", FAKE_PROJECT_NUMBER).replace("__URL__", FAKE_URL)

BASH = shutil.which("bash") or "/bin/bash"


class Mock:
    """A fake-gcloud sandbox: ``env`` for subprocess, helpers to read what gcloud saw."""

    def __init__(self, root: Path, *, restricted: bool = False, with_gcloud: bool = True,
                 drop: tuple[str, ...] = ()):
        self.dir = root / "gcloud-state"
        self.dir.mkdir()
        bindir = root / "mockbin"
        bindir.mkdir()
        if with_gcloud:
            exe = bindir / "gcloud"
            exe.write_text(FAKE_GCLOUD_SH)
            exe.chmod(0o755)
        env = {k: v for k, v in os.environ.items() if not k.startswith(("FAKE_", "CLOUDSDK_"))}
        env["FAKE_GCLOUD_DIR"] = str(self.dir)
        env["TMPDIR"] = str(root / "tmp")
        (root / "tmp").mkdir()
        if restricted:
            # Only the tools the scripts and the fake need; nothing else (no real gcloud).
            for tool in ("bash", "sh", "mktemp", "cp", "rm", "sed", "dirname", "cat", "openssl", "python3"):
                if tool in drop:
                    continue
                src = shutil.which(tool)
                if src:
                    (bindir / tool).symlink_to(src)
            env["PATH"] = str(bindir)
        else:
            env["PATH"] = f"{bindir}{os.pathsep}{env['PATH']}"
        if with_gcloud:
            assert shutil.which("gcloud", path=env["PATH"]) == str(bindir / "gcloud"), "fake gcloud not first"
        else:
            assert shutil.which("gcloud", path=env["PATH"]) is None
        self.env = env
        self.tmp = root / "tmp"

    def run(self, script: Path, args: list[str], stdin: str | None = None, **extra: str):
        env = dict(self.env, **extra)
        return subprocess.run([BASH, str(script), *args], capture_output=True, text=True, env=env,
                              input=stdin if stdin is not None else "", timeout=60)

    def calls(self) -> list[str]:
        log = self.dir / "calls.log"
        return log.read_text().splitlines() if log.exists() else []


@pytest.fixture()
def mock(tmp_path):
    return Mock(tmp_path)


def _idx(calls: list[str], prefix: str) -> int:
    for i, c in enumerate(calls):
        if c.startswith(prefix):
            return i
    raise AssertionError(f"no gcloud call starting with {prefix!r}: {calls}")


# --------------------------------------------------------------------------- deploy.sh, mocked real mode

@needs_bash
def test_deploy_real_mode_fresh_project_sequence(mock):
    res = mock.run(DEPLOY, ["--project", "p1", "--region", "europe-west1"])
    assert res.returncode == 0, res.stderr
    calls = mock.calls()
    order = [
        "services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com "
        "secretmanager.googleapis.com storage.googleapis.com --project p1",
        "storage buckets describe gs://p1-vibe-crypto-data",
        "storage buckets create gs://p1-vibe-crypto-data --project p1 --location europe-west1 "
        "--uniform-bucket-level-access --public-access-prevention",
        "secrets describe vibe-crypto-mcp-token --project p1",
        "secrets create vibe-crypto-mcp-token --data-file=- --replication-policy=automatic --project p1",
        "projects describe p1 --format=value(projectNumber)",
        "secrets add-iam-policy-binding vibe-crypto-mcp-token --project p1 "
        f"--member serviceAccount:{FAKE_PROJECT_NUMBER}-compute@developer.gserviceaccount.com "
        "--role roles/secretmanager.secretAccessor",
        "storage buckets add-iam-policy-binding gs://p1-vibe-crypto-data "
        f"--member serviceAccount:{FAKE_PROJECT_NUMBER}-compute@developer.gserviceaccount.com "
        "--role roles/storage.objectUser",
        "run deploy vibe-crypto-mcp --source ",
        "run services describe vibe-crypto-mcp --project p1 --region europe-west1 --format=value(status.url)",
    ]
    positions = [_idx(calls, o) for o in order]
    assert positions == sorted(positions), calls
    assert not any(c.startswith("secrets versions access") for c in calls), "fresh secret must not be read back"
    # The generated token went in on stdin (never argv) and is the one printed in both URL forms.
    token = (mock.dir / "secret-stdin").read_text()
    assert TOKEN_RE.fullmatch(token), token
    assert not any(token in c for c in calls), "token leaked into gcloud argv"
    assert f"{FAKE_URL}/{token}/mcp" in res.stdout
    assert (f'claude mcp add --transport http vibe-crypto {FAKE_URL}/mcp '
            f'--header "Authorization: Bearer {token}"') in res.stdout
    assert "WARNING" in res.stdout and "Never share the URL or the token" in res.stdout


@needs_bash
def test_deploy_real_mode_deploy_args_and_staged_source(mock):
    res = mock.run(DEPLOY, ["--project", "p2", "--with", "keyring,,alpaca-py,", "--ref", "v9.9.9",
                            "--memory", "4Gi", "--service", "svc-x", "--bucket", "bk-x", "--enable-orders"])
    assert res.returncode == 0, res.stderr
    args = (mock.dir / "deploy-args").read_text().splitlines()
    assert args[:3] == ["run", "deploy", "svc-x"]

    def val(flag: str) -> str:
        return args[args.index(flag) + 1]

    assert val("--project") == "p2" and val("--region") == "us-central1"
    assert val("--port") == "8080" and val("--memory") == "4Gi" and val("--timeout") == "3600"
    assert val("--min-instances") == "1" and val("--max-instances") == "1" and val("--cpu") == "1"
    assert val("--execution-environment") == "gen2"
    assert val("--set-secrets") == "VIBE_CRYPTO_MCP_TOKEN=vibe-crypto-mcp-token:latest"
    assert val("--set-env-vars") == "VIBE_CRYPTO_MCP_ENABLE_ORDERS=1"
    assert val("--add-volume") == "name=data,type=cloud-storage,bucket=bk-x,mount-options=uid=1000;gid=1000;implicit-dirs"
    assert val("--add-volume-mount") == "volume=data,mount-path=/home/vibe/.vibe-trading"
    assert "--allow-unauthenticated" in args and args[-1] == "--quiet"
    # The source dir handed to gcloud held exactly the Dockerfile and the generated requirements.
    snap = mock.dir / "source-snapshot"
    assert sorted(p.name for p in snap.iterdir()) == ["Dockerfile", "requirements.txt"]
    assert (snap / "Dockerfile").read_bytes() == (GCP / "Dockerfile").read_bytes()
    assert (snap / "requirements.txt").read_text().splitlines() == [
        "vibe-crypto[keyring] @ git+https://github.com/buckleson/vibe-trading-crypto@v9.9.9",
        "keyring",
        "alpaca-py",
    ]
    # ... and the staging dir is removed when the script exits.
    assert not Path((mock.dir / "source-path").read_text()).exists()
    assert list(mock.tmp.iterdir()) == []


@needs_bash
def test_deploy_real_mode_reuses_existing_bucket_and_secret(mock):
    res = mock.run(DEPLOY, ["--project", "p3"], FAKE_BUCKET_RC="0", FAKE_SECRET_RC="0")
    assert res.returncode == 0, res.stderr
    calls = mock.calls()
    assert not any(c.startswith("storage buckets create") for c in calls)
    assert not any(c.startswith("secrets create") for c in calls)
    assert any(c.startswith("secrets versions access latest --secret vibe-crypto-mcp-token --project p3") for c in calls)
    assert f"{FAKE_URL}/{FAKE_EXISTING_TOKEN}/mcp" in res.stdout
    assert "already exists" in res.stdout


@needs_bash
def test_deploy_real_mode_default_project_from_gcloud_config(mock):
    res = mock.run(DEPLOY, [], FAKE_PROJECT="cfg-proj")
    assert res.returncode == 0, res.stderr
    calls = mock.calls()
    assert calls[0].startswith("config get-value project")
    assert any("gs://cfg-proj-vibe-crypto-data" in c for c in calls)


@needs_bash
@pytest.mark.parametrize("value", ["", "(unset)"])
def test_deploy_real_mode_no_project_configured(mock, value):
    res = mock.run(DEPLOY, [], FAKE_PROJECT=value)
    assert res.returncode == 2
    assert "no project" in res.stderr
    assert [c for c in mock.calls() if not c.startswith("config get-value")] == []


@needs_bash
def test_deploy_stops_on_first_gcloud_failure_and_cleans_up(mock):
    res = mock.run(DEPLOY, ["--project", "p4"], FAKE_GCLOUD_FAIL_ON="run deploy")
    assert res.returncode != 0
    assert "Deployed." not in res.stdout
    assert not any(c.startswith("run services describe") for c in mock.calls())
    assert list(mock.tmp.iterdir()) == [], "staging dir left behind after a failed deploy"


@needs_bash
def test_deploy_stops_when_api_enable_fails(mock):
    res = mock.run(DEPLOY, ["--project", "p5"], FAKE_GCLOUD_FAIL_ON="services enable")
    assert res.returncode != 0
    assert len(mock.calls()) == 1


@needs_bash
def test_deploy_without_gcloud_installed(tmp_path):
    m = Mock(tmp_path, restricted=True, with_gcloud=False)
    res = m.run(DEPLOY, ["--project", "p6"])
    assert res.returncode == 1
    assert "gcloud is not installed" in res.stderr
    # --dry-run does not need gcloud at all.
    res = m.run(DEPLOY, ["--project", "p6", "--dry-run"])
    assert res.returncode == 0, res.stderr
    assert "gcloud run deploy vibe-crypto-mcp" in res.stdout


@needs_bash
@pytest.mark.skipif(shutil.which("openssl") is None, reason="openssl not installed")
def test_deploy_token_falls_back_to_openssl_without_python3(tmp_path):
    m = Mock(tmp_path, restricted=True, drop=("python3",))
    assert shutil.which("python3", path=m.env["PATH"]) is None
    res = m.run(DEPLOY, ["--project", "p7"])
    assert res.returncode == 0, res.stderr
    token = (m.dir / "secret-stdin").read_text()
    assert re.fullmatch(r"[0-9a-f]{64}", token), token
    assert TOKEN_RE.fullmatch(token)
    assert f"{FAKE_URL}/{token}/mcp" in res.stdout


@needs_bash
def test_generated_tokens_pass_the_server_validator():
    sys.path.insert(0, str(AGENT))
    try:
        import mcp_server  # noqa: PLC0415
    finally:
        sys.path.remove(str(AGENT))
    py = subprocess.run(["python3", "-c", "import secrets; print(secrets.token_urlsafe(32))"],
                        capture_output=True, text=True).stdout.strip()
    assert mcp_server._validate_token(py) == py
    assert mcp_server._validate_token("a" * 64) == "a" * 64  # openssl rand -hex 32 shape
    with pytest.raises(ValueError):
        mcp_server._validate_token("<token>")  # dry-run placeholder must never be a usable token


# --------------------------------------------------------------------------- argument handling (both scripts)

DEPLOY_VALUE_FLAGS = ["--project", "--region", "--service", "--bucket", "--ref", "--with", "--memory"]
TEARDOWN_VALUE_FLAGS = ["--project", "--region", "--service", "--bucket"]


@needs_bash
@pytest.mark.parametrize("script,flag", [(DEPLOY, f) for f in DEPLOY_VALUE_FLAGS]
                         + [(TEARDOWN, f) for f in TEARDOWN_VALUE_FLAGS],
                         ids=lambda x: x.name if isinstance(x, Path) else x)
def test_flag_without_value_is_rejected(mock, script, flag):
    for args in ([flag], [flag, ""], ["--dry-run", flag]):
        res = mock.run(script, args)
        assert res.returncode == 2, (args, res.stdout, res.stderr)
        assert "needs a value" in res.stderr
    assert mock.calls() == []


@needs_bash
@pytest.mark.parametrize("script", [DEPLOY, TEARDOWN], ids=lambda p: p.name)
def test_help_lists_every_flag_and_runs_nothing(mock, script):
    for h in ("-h", "--help"):
        res = mock.run(script, [h])
        assert res.returncode == 0
        flags = set(re.findall(r"^\s+(--[a-z-]+)", res.stdout, flags=re.M))
        parsed = set(re.findall(r"^\s+(--[a-z-]+)\)", script.read_text(), flags=re.M))
        assert parsed <= flags, parsed - flags
    assert mock.calls() == []


@needs_bash
def test_teardown_dry_run_requires_project(mock):
    res = mock.run(TEARDOWN, ["--dry-run"])
    assert res.returncode == 2 and mock.calls() == []
    res = mock.run(TEARDOWN, ["--bogus"])
    assert res.returncode == 2 and "unknown option" in res.stderr


# --------------------------------------------------------------------------- dry-run output is real bash

def _plus_lines(out: str) -> list[str]:
    return [line[2:] for line in out.splitlines() if line.startswith("+ ")]


@needs_bash
def test_dry_run_lines_are_valid_bash_and_round_trip(mock):
    res = mock.run(DEPLOY, ["--dry-run", "--project", "demo-proj", "--region", "europe-west1"])
    lines = _plus_lines(res.stdout)
    assert len(lines) >= 8
    script = "\n".join(lines) + "\n"
    assert subprocess.run([BASH, "-n"], input=script, text=True, capture_output=True).returncode == 0
    deploy = next(shlex.split(line) for line in lines if line.startswith("gcloud run deploy "))
    assert deploy[deploy.index("--add-volume") + 1] == (
        "name=data,type=cloud-storage,bucket=demo-proj-vibe-crypto-data,mount-options=uid=1000;gid=1000;implicit-dirs")
    assert deploy[deploy.index("--region") + 1] == "europe-west1"
    create = next(shlex.split(line) for line in lines if line.startswith("gcloud storage buckets create"))
    assert create[create.index("--location") + 1] == "europe-west1"
    # Every printed gcloud command is one the script would really run (same verbs as mocked real mode).
    verbs = {" ".join(shlex.split(line.split("|")[-1])[:3]) for line in lines}
    assert {"gcloud services enable", "gcloud storage buckets", "gcloud secrets create", "gcloud secrets versions",
            "gcloud projects describe", "gcloud secrets add-iam-policy-binding", "gcloud run deploy",
            "gcloud run services"} <= verbs
    # The dry-run staging dir is cleaned too.
    staged = re.search(r"^Staged (\S+) with requirements", res.stdout, flags=re.M).group(1)
    assert not Path(staged).exists()


@needs_bash
def test_dry_run_matches_mocked_real_run(tmp_path):
    """The dry-run deploy command is the same argv the real run hands to gcloud (bar the temp dir)."""
    (tmp_path / "a").mkdir()
    dry = Mock(tmp_path / "a")
    res = dry.run(DEPLOY, ["--dry-run", "--project", "pp", "--with", "keyring,ccxt"])
    printed = next(shlex.split(line) for line in _plus_lines(res.stdout) if line.startswith("gcloud run deploy "))
    (tmp_path / "b").mkdir()
    real = Mock(tmp_path / "b")
    assert real.run(DEPLOY, ["--project", "pp", "--with", "keyring,ccxt"]).returncode == 0
    actual = ["gcloud", *(real.dir / "deploy-args").read_text().splitlines()]
    src_i = printed.index("--source") + 1
    printed[src_i] = actual[src_i] = "<dir>"
    assert printed == actual


# --------------------------------------------------------------------------- teardown.sh, mocked real mode

@needs_bash
def test_teardown_real_mode_default_only_deletes_service(mock):
    res = mock.run(TEARDOWN, ["--project", "p", "--region", "asia-east1", "--service", "s1"])
    assert res.returncode == 0, res.stderr
    assert mock.calls() == ["run services delete s1 --project p --region asia-east1 --quiet"]
    assert "gs://p-vibe-crypto-data" in res.stdout and "vibe-crypto-mcp-token" in res.stdout


@needs_bash
@pytest.mark.parametrize("answer", ["wrong-name\n", "", "p-vibe-crypto-data-extra\n"])
def test_teardown_delete_data_confirmation_refused(mock, answer):
    res = mock.run(TEARDOWN, ["--project", "p", "--delete-data", "--delete-secret"], stdin=answer)
    assert res.returncode != 0
    calls = mock.calls()
    assert not any(c.startswith("storage rm") for c in calls)
    assert not any(c.startswith("secrets delete") for c in calls), "secret deleted after a refused confirmation"


@needs_bash
def test_teardown_delete_data_confirmation_accepted(mock):
    res = mock.run(TEARDOWN, ["--project", "p", "--bucket", "my-bk", "--delete-data", "--delete-secret"],
                   stdin="my-bk\n")
    assert res.returncode == 0, res.stderr
    assert mock.calls() == [
        "run services delete vibe-crypto-mcp --project p --region us-central1 --quiet",
        "storage rm --recursive gs://my-bk",
        "secrets delete vibe-crypto-mcp-token --project p --quiet",
    ]
    assert "Nothing kept" in res.stdout


@needs_bash
def test_teardown_yes_skips_prompt(mock):
    res = mock.run(TEARDOWN, ["--project", "p", "--delete-data", "--yes"], stdin="")
    assert res.returncode == 0, res.stderr
    assert "Type the bucket name" not in res.stdout
    assert "storage rm --recursive gs://p-vibe-crypto-data" in mock.calls()
    assert "Kept:" in res.stdout and "vibe-crypto-mcp-token" in res.stdout


@needs_bash
def test_teardown_service_delete_failure_stops(mock):
    res = mock.run(TEARDOWN, ["--project", "p", "--delete-data", "--yes"], FAKE_GCLOUD_FAIL_ON="run services delete")
    assert res.returncode != 0
    assert len(mock.calls()) == 1


# --------------------------------------------------------------------------- Dockerfile and server contract

def _docker_cmd() -> list[str]:
    line = next(l for l in (GCP / "Dockerfile").read_text().splitlines() if l.startswith("CMD "))
    return json.loads(line[4:])


def test_dockerfile_cmd_uses_real_flags_and_matches_mount():
    text = (GCP / "Dockerfile").read_text(encoding="utf-8")
    cmd = _docker_cmd()
    assert cmd[:2] == ["sh", "-c"] and cmd[2].startswith("exec ")
    flags = set(re.findall(r"--[a-z-]+", cmd[2]))
    sys.path.insert(0, str(AGENT))
    try:
        import mcp_server  # noqa: PLC0415
    finally:
        sys.path.remove(str(AGENT))
    help_text = subprocess.run([sys.executable, str(AGENT / "mcp_server.py"), "--help"],
                               capture_output=True, text=True, timeout=120).stdout
    assert flags <= set(re.findall(r"--[a-z-]+", help_text)), flags
    assert re.search(r"^RUN pip install --no-cache-dir uv==\d+\.\d+\.\d+$", text, flags=re.M)
    # uid in the image == uid in the bucket mount options; mount path == HOME/.vibe-trading.
    deploy = DEPLOY.read_text()
    uid = re.search(r"--uid (\d+)", text).group(1)
    assert f"uid={uid};gid={uid}" in deploy
    assert "ENV HOME=/home/vibe" in text and "mount-path=/home/vibe/.vibe-trading" in deploy
    assert "ENV HOME=/home/vibe PYTHONUNBUFFERED=1 PORT=8080" in text and "--port 8080" in deploy
    assert "VIBE_CRYPTO_MCP_TOKEN" not in re.sub(r"(?m)^#.*$", "", text), "token must not be baked into the image"


def test_requirements_line_targets_real_package_and_extra():
    import tomllib  # noqa: PLC0415

    py = tomllib.loads((REPO / "pyproject.toml").read_text())
    assert py["project"]["name"] == "vibe-crypto"
    assert "keyring" in py["project"]["optional-dependencies"]
    assert py["project"]["scripts"]["vibe-crypto-mcp"] == "mcp_server:main"
    assert "vibe-crypto[keyring] @ git+https://github.com/buckleson/vibe-trading-crypto@${REF}" in DEPLOY.read_text()


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _server_env(tmp_path: Path, **extra: str) -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith(("VIBE_CRYPTO_MCP", "VIBE_TRADING_MCP"))}
    env.update(HOME=str(tmp_path), NO_PROXY="127.0.0.1,localhost", no_proxy="127.0.0.1,localhost")
    env["PATH"] = f"{Path(sys.executable).parent}{os.pathsep}{env['PATH']}"
    env.update(extra)
    return env


needs_console_script = pytest.mark.skipif(
    not (Path(sys.executable).parent / "vibe-crypto-mcp").exists(), reason="vibe-crypto-mcp not installed in venv")


@pytest.mark.integration
@needs_console_script
def test_docker_cmd_refuses_to_start_without_token(tmp_path):
    res = subprocess.run(_docker_cmd(), env=_server_env(tmp_path, PORT=str(_free_port())),
                         capture_output=True, text=True, timeout=120)
    assert res.returncode == 2
    assert "Refusing to listen on 0.0.0.0 without a token" in res.stderr
    # The guide's troubleshooting entry quotes this message.
    assert "Refusing to listen on 0.0.0.0 without a token" in GUIDE_TEXT


@pytest.mark.integration
@needs_console_script
def test_docker_cmd_serves_cloud_run_host_with_token(tmp_path):
    import httpx  # noqa: PLC0415

    tok = "cloudrun_token_" + "x" * 20
    port = _free_port()
    proc = subprocess.Popen(_docker_cmd(), env=_server_env(tmp_path, PORT=str(port), VIBE_CRYPTO_MCP_TOKEN=tok),
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        deadline = time.time() + 120
        while time.time() < deadline:
            assert proc.poll() is None, proc.stdout.read()
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.5).close()
                break
            except OSError:
                time.sleep(0.3)
        else:
            pytest.fail("server not ready")
        body = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                           "clientInfo": {"name": "t18", "version": "0"}}}
        base = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
                "Host": "vibe-crypto-mcp-abc-ew.a.run.app"}
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=30, trust_env=False) as c:
            assert c.post(f"/{tok}/mcp", json=body, headers=base).status_code == 200  # ChatGPT form
            assert c.post("/mcp", json=body, headers={**base, "Authorization": f"Bearer {tok}"}).status_code == 200
            assert c.post("/mcp", json=body, headers=base).status_code == 401
            assert c.post("/mcp", json=body, headers={**base, "Authorization": f"Bearer {tok}x"}).status_code == 401
            assert c.post(f"/{tok}x/mcp", json=body, headers=base).status_code == 401
            assert c.post("/<token>/mcp", json=body, headers=base).status_code == 401
    finally:
        proc.terminate()
        try:
            out, _ = proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            out, _ = proc.communicate()
    # Container stdout goes to Cloud Run logs: the server itself must not print the path token.
    assert tok not in out


# --------------------------------------------------------------------------- guide consistency with the repo

def _json_blocks(text: str) -> list[dict]:
    return [json.loads(b) for b in re.findall(r"```json\n(.*?)```", text, flags=re.S)]


def test_guide_json_snippets_parse_and_match_plugin_command():
    plugin = json.loads((REPO / "plugins" / "vibe-crypto" / ".mcp.json").read_text())["mcpServers"]["vibe-crypto"]
    plugin_args = [a.replace("${VIBE_CRYPTO_WITH:-keyring}", "keyring") for a in plugin["args"]]
    blocks = _json_blocks(GUIDE_TEXT)
    assert len(blocks) >= 2  # Claude Desktop and Cursor
    for block in blocks:
        server = block["mcpServers"]["vibe-crypto"]
        assert server["command"] == plugin["command"] == "uvx"
        assert server["args"] == plugin_args
        assert " ".join(["uvx", *server["args"]]) == CANON
        for k, v in server.get("env", {}).items():
            assert k == "VIBE_CRYPTO_MCP_ENABLE_ORDERS" and v == "0", "orders must default off in snippets"


def test_guide_every_uvx_command_uses_canonical_source():
    lines = [l for l in GUIDE_TEXT.splitlines() if re.search(r"\buvx\b.*--from", l)]
    assert len(lines) >= 5
    for line in lines:
        assert "--python 3.12" in line, line
        assert "--from git+https://github.com/buckleson/vibe-trading-crypto " in line, line
        assert re.search(r"--with keyring\b", line), line
    assert f"claude mcp add vibe-crypto -- {CANON}" in GUIDE_TEXT


def test_guide_package_column_matches_onboarding():
    sys.path.insert(0, str(AGENT))
    try:
        from src.trading import onboarding  # noqa: PLC0415
    finally:
        sys.path.remove(str(AGENT))
    deps = {k: v.dependency for k, v in onboarding._BUILTIN.items()}
    deps["ibkr"] = "ib_async"  # local_tws branch of onboarding_for_profile
    for name in CONNECTORS:
        cell = re.search(rf"^\|\s*{name}\s*\|([^\n]*)", GUIDE_TEXT, flags=re.M).group(1).split("|")[4].strip()
        if name in deps:
            assert f"`{deps[name]}`" in cell, (name, cell)
        elif name in ("robinhood", "scalable"):  # remote_mcp OAuth profiles: no local package
            assert cell.startswith("none"), (name, cell)
        else:  # no onboarding entry: the package must be the one the connector SDK imports
            pkg = re.search(r"`([^`]+)`", cell).group(1)
            sdk = (AGENT / "src" / "trading" / "connectors" / name / "sdk.py").read_text()
            assert re.search(rf"^\s*(from|import) {re.escape(pkg)}\b", sdk, flags=re.M), (name, pkg)


def test_guide_broker_table_has_exactly_19_rows():
    table = GUIDE_TEXT.split("| Broker | Market or region |", 1)[1].split("\n\n", 1)[0]
    rows = [l for l in table.splitlines()[2:] if l.startswith("|")]
    assert [r.split("|")[1].strip() for r in rows] == CONNECTORS


def test_guide_plugin_commands_and_skill_exist():
    commands = set(re.findall(r"/vibe-crypto:([a-z-]+)", GUIDE_TEXT))
    assert commands == {"connect-broker", "portfolio", "paper-run", "status"}
    for c in commands:
        assert (REPO / "plugins" / "vibe-crypto" / "commands" / f"{c}.md").is_file(), c
    assert "`safe-trading`" in GUIDE_TEXT
    assert (REPO / "plugins" / "vibe-crypto" / "skills" / "safe-trading" / "SKILL.md").is_file()
    market = json.loads((REPO / ".claude-plugin" / "marketplace.json").read_text())
    assert market["name"] == "vibe-crypto" and [p["name"] for p in market["plugins"]] == ["vibe-crypto"]


def test_guide_mcpb_url_matches_release_asset():
    workflow = (REPO / ".github" / "workflows" / "desktop-windows.yml").read_text()
    assert "vibe-crypto-claude-desktop.mcpb" in workflow


def test_guide_tunnel_port_matches_server_default_and_token_rule():
    port = re.search(r"--port (\d+)", GUIDE_TEXT).group(1)
    assert f"cloudflared tunnel --url http://127.0.0.1:{port}" in GUIDE_TEXT
    assert f"ngrok http {port}" in GUIDE_TEXT
    server = (AGENT / "mcp_server.py").read_text()
    assert re.search(rf'"--port".*default={port}', server) or f"default: {port}" in server
    assert "16 to 256 characters" in GUIDE_TEXT and "{16,256}" in server
    assert "https://<tunnel-host>/<token>/mcp" in GUIDE_TEXT
    assert ('claude mcp add --transport http vibe-crypto https://<tunnel-host>/mcp '
            '--header "Authorization: Bearer <token>"') in GUIDE_TEXT


def test_guide_cli_commands_exist():
    legacy = (AGENT / "cli" / "_legacy.py").read_text()
    assert "vibe-crypto connector setup alpaca-paper-trade --connection-id my-alpaca" in GUIDE_TEXT
    assert 'connector_setup.add_argument("--connection-id"' in legacy
    assert 'if sub == "halt":' in legacy and 'if sub == "resume":' in legacy
    assert "/halt" in (AGENT / "cli" / "main.py").read_text()
    assert "--enable-order-tools" in GUIDE_TEXT and '"--enable-order-tools"' in (AGENT / "mcp_server.py").read_text()


def _slugs(md: str) -> set[str]:
    md = re.sub(r"```.*?```", "", md, flags=re.S)
    out = set()
    for h in re.findall(r"^#{1,6} (.+)$", md, flags=re.M):
        s = re.sub(r"[^\w\- ]", "", h.strip().lower()).replace(" ", "-")
        out.add(s)
    return out


@pytest.mark.parametrize("doc", [GUIDE, GCP / "README.md"], ids=lambda p: str(p.relative_to(REPO)))
def test_links_and_anchors_resolve(doc):
    text = re.sub(r"```.*?```", "", doc.read_text(encoding="utf-8"), flags=re.S)
    for href in re.findall(r"\]\(([^)\s]+)\)", text):
        if re.match(r"^(https?:|mailto:)", href):
            continue
        path, _, anchor = href.partition("#")
        target = (doc.parent / path).resolve() if path else doc
        assert target.exists(), href
        if anchor and target.suffix == ".md":
            assert anchor in _slugs(target.read_text(encoding="utf-8")), href


def test_gcp_readme_contract():
    text = (GCP / "README.md").read_text(encoding="utf-8")
    for needle in (
        "gcloud auth login",
        "git clone https://github.com/buckleson/vibe-trading-crypto",
        "gcloud storage cp",
        "--set-secrets",
        "--with",
        "--ref",
        "gcloud secrets versions add vibe-crypto-mcp-token",
        "/<token>/mcp",
        "Authorization: Bearer <token>",
        "No authentication",
        "--delete-data",
        "locking",
    ):
        assert needle in text, needle
    assert "../../guides/share-with-friends.md" in text


@pytest.mark.parametrize("doc", [GCP / "Dockerfile", DEPLOY, TEARDOWN], ids=lambda p: p.name)
def test_deploy_files_style(doc):
    text = doc.read_text(encoding="utf-8")
    assert EM_DASH not in text and not EMOJI_RE.search(text)


# --------------------------------------------------------------------------- README, mcp.md, CLAUDE_CODE.md, handoff

README_TEXT = README.read_text(encoding="utf-8")


def _section(text: str, title: str) -> str:
    return text.split(f"\n## {title}\n", 1)[1].split("\n## ", 1)[0]


def test_readme_share_section_content():
    body = _section(README_TEXT, "Share with friends")
    for needle in ("/plugin marketplace add buckleson/vibe-trading-crypto", "/plugin install vibe-crypto@vibe-crypto",
                   "vibe-crypto-claude-desktop.mcpb", "uvx", "ChatGPT", "Cloud Run"):
        assert needle in body, needle
    assert re.search(r"own (copy|server)", body)
    lines = [l for l in body.strip().splitlines() if l.strip()]
    assert 4 <= len(lines) <= 12, len(lines)


def test_readme_use_with_claude_and_security_model():
    use = _section(README_TEXT, "Use with Claude")
    assert len(re.findall(r"^\d+\. ", use, flags=re.M)) == 3
    assert "claude mcp add vibe-crypto -- vibe-crypto-mcp" in README_TEXT
    assert re.search(r"cannot place live orders", README_TEXT)
    sec = _section(README_TEXT, "Security model")
    assert "VIBE_CRYPTO_MCP_TOKEN" in sec and "VIBE_TRADING_ENABLE_SHELL_TOOLS" in sec
    assert any("live order" in l.lower() and "Claude" in l for l in sec.splitlines())
    assert not re.search(r"live orders? (are|is) never available", README_TEXT, flags=re.I)
    h2 = re.findall(r"^## (.+)$", README_TEXT, flags=re.M)
    assert h2[-1] == "Credits"


def test_mcp_guide_and_claude_code_doc():
    mcp = (REPO / "guides" / "mcp.md").read_text(encoding="utf-8")
    for needle in ("share-with-friends.md", "VIBE_CRYPTO_MCP_TOKEN", "/<token>/mcp", "--allowed-hosts",
                   "Order tools (opt-in)", "--enable-order-tools", "87", CANON):
        assert needle in mcp, needle
    cc = (REPO / "docs" / "vibe-crypto" / "CLAUDE_CODE.md").read_text(encoding="utf-8")
    for needle in ("Install without cloning", "VIBE_CRYPTO_MCP_ENABLE_ORDERS=1", "--enable-order-tools",
                   "VIBE_CRYPTO_MCP_TOKEN"):
        assert needle in cc, needle


def test_handoff_and_todo_updated():
    handoff = (REPO / "docs" / "vibe-crypto" / "HANDOFF.md").read_text(encoding="utf-8")
    assert "0008" in handoff and "Sharing" in handoff
    for t in ("T15", "T16", "T17", "T18"):
        assert re.search(rf"^\|\s*{t}\s*\|", handoff, flags=re.M), t
    todo = (REPO / "docs" / "vibe-crypto" / "TODO.md").read_text(encoding="utf-8")
    sharing = todo.split("Sharing: plugins, extension, remote MCP (ADR 0008)", 1)[1]
    sharing = re.split(r"\n## (?!Wave )", sharing, maxsplit=1)[0]
    assert all(f"### {t}" in sharing for t in ("T15", "T16", "T17", "T18"))
    boxes = re.findall(r"^\s*- \[( |x)\] (.*)$", sharing, flags=re.M)
    assert boxes, "no checkboxes in the sharing section"
    for state, text in boxes:
        assert state == "x" or len(text) > 20, f"unticked box without a reason: {text}"
    assert (REPO / "docs" / "vibe-crypto" / "handoff" / "T18.md").is_file()


def test_no_requirements_or_secrets_left_in_deploy_dir():
    names = {p.name for p in GCP.iterdir()}
    assert names == {"Dockerfile", "README.md", "deploy.sh", "teardown.sh"}, names
