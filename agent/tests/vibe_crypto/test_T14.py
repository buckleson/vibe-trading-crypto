"""T14 acceptance tests: README rewrite, guides update, asset prune, HANDOFF and TODO.

Offline and deterministic. Everything here reads files in the repo, imports the MCP
server in-process (no network), runs the local ``vibe-crypto`` CLI with ``--help`` and
``mcp config`` (no network), and optionally reads ``git show HEAD:...`` (skipped when git
or the HEAD blob is unavailable). No exchange, Anthropic API or Claude CLI is contacted.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
AGENT_DIR = REPO / "agent"
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

README = REPO / "README.md"
SECURITY = REPO / "SECURITY.md"
CONTRIBUTING = REPO / "CONTRIBUTING.md"
AGENT_GUIDE = REPO / "AGENT_CONTRIBUTOR_GUIDE.md"
GUIDES = REPO / "guides"
DOCS = REPO / "docs" / "vibe-crypto"
HANDOFF = DOCS / "HANDOFF.md"
TODO = DOCS / "TODO.md"
T14_NOTE = DOCS / "handoff" / "T14.md"
ASSETS = REPO / "assets"

EXCLUDED_DIRS = {
    ".git", "node_modules", ".venv", "dist", "__pycache__", ".pytest_cache",
    "release", "build", ".mypy_cache", ".ruff_cache",
}
TEXT_SUFFIXES = {
    ".md", ".py", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".toml", ".yml",
    ".yaml", ".html", ".css", ".txt", ".in", ".cfg", ".ini", ".sh", ".ps1", ".example",
    ".svg", ".env",
}
EM_DASH = "—"
EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF\U0001F900-\U0001F9FF]"
)

GEN_BEGIN = "<!-- BEGIN GENERATED broker-capability-matrix -->"
GEN_END = "<!-- END GENERATED broker-capability-matrix -->"


# --------------------------------------------------------------------------- helpers


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def strip_generated(text: str) -> str:
    """Remove the generated broker matrix block (owned by a generator, risk 7)."""
    out, keep = [], True
    for line in text.splitlines():
        if GEN_BEGIN in line:
            keep = False
            continue
        if GEN_END in line:
            keep = True
            continue
        if keep:
            out.append(line)
    return "\n".join(out)


def strip_code(text: str) -> str:
    """Drop fenced code blocks and inline code spans."""
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    return re.sub(r"`[^`\n]*`", "", text)


def sections(text: str, level: int = 2) -> dict[str, str]:
    """Map heading text -> body for headings of exactly ``level``, ignoring code fences."""
    prefix = "#" * level + " "
    result: dict[str, str] = {}
    current, buf, in_code = None, [], False
    for line in text.splitlines():
        if line.startswith("```"):
            in_code = not in_code
        if not in_code and line.startswith(prefix) and not line.startswith(prefix + "#"):
            if current is not None:
                result[current] = "\n".join(buf)
            current, buf = line[len(prefix):].strip(), []
        elif current is not None:
            buf.append(line)
    if current is not None:
        result[current] = "\n".join(buf)
    return result


def headings(text: str) -> list[tuple[int, str]]:
    out, in_code = [], False
    for line in text.splitlines():
        if line.startswith("```"):
            in_code = not in_code
            continue
        m = re.match(r"^(#{1,6}) (.+)$", line)
        if m and not in_code:
            out.append((len(m.group(1)), m.group(2).strip()))
    return out


def code_blocks(text: str) -> list[str]:
    return re.findall(r"```[a-zA-Z]*\n(.*?)```", text, flags=re.S)


def md_links(text: str) -> list[str]:
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    return re.findall(r"\]\(([^)\s]+)\)", text)


def iter_repo_text_files():
    for root, dirs, files in os.walk(REPO):
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS and not d.endswith(".egg-info")]
        for f in files:
            p = Path(root) / f
            if p.suffix.lower() in TEXT_SUFFIXES or f in {"Dockerfile", "MANIFEST.in", ".gitignore"}:
                yield p


def files_containing(needle: str) -> set[str]:
    hits = set()
    for p in iter_repo_text_files():
        try:
            if needle in p.read_text(encoding="utf-8", errors="ignore"):
                hits.add(p.relative_to(REPO).as_posix())
        except OSError:
            continue
    return hits


# Words allowed to be capitalised inside a sentence-case heading.
PROPER = {
    "Vibe", "Crypto", "Claude", "Code", "MetaMask", "Docker", "MCP", "API", "CLI", "UI",
    "SSE", "ADR", "HANDOFF.md", "TODO.md", "README", "T14", "T01", "T13", "SDK", "Agent",
    "Windows", "macOS", "Linux", "Electron", "OKX", "CCXT", "Binance", "HKUDS",
    "Vibe-Trading", "IM", "LLM", "P&L", "DCO", "MIT", "GitHub", "I", "US", "HK", "CN",
}


def is_sentence_case(heading: str) -> bool:
    words = re.findall(r"[A-Za-z][A-Za-z0-9.&'-]*", heading)
    for w in words[1:]:
        if w[0].isupper() and w not in PROPER and not w.isupper():
            return False
    return True


# --------------------------------------------------------------------------- README


README_TEXT = read(README)
README_SECTIONS = sections(README_TEXT)

REQUIRED_README_SECTIONS = [
    "What you can do",
    "Quick start",
    "Desktop app",
    "Use with Claude",
    "Paper trading",
    "Configuration",
    "Security model",
    "Development",
    "Disclaimer",
    "Credits",
]


def test_readme_title_is_vibe_crypto():
    first = README_TEXT.splitlines()[0]
    assert first == "# Vibe Crypto"
    assert sum(1 for lvl, _ in headings(README_TEXT) if lvl == 1) == 1


def test_readme_intro_describes_local_ai_app_with_claude():
    intro = README_TEXT.split("\n## ", 1)[0]
    low = intro.lower()
    for word in ("local", "research", "backtesting", "paper trading", "crypto", "stocks", "claude"):
        assert word in low, word
    # Two sentences in the first paragraph (spec (a)).
    para = intro.split("\n\n")[1]
    assert len(re.findall(r"[.!?](\s|$)", para)) >= 2


@pytest.mark.parametrize("name", REQUIRED_README_SECTIONS)
def test_readme_has_required_section(name):
    assert name in README_SECTIONS, f"missing ## {name}"
    assert README_SECTIONS[name].strip(), f"## {name} is empty"


def test_readme_sections_in_spec_order():
    order = [h for lvl, h in headings(README_TEXT) if lvl == 2]
    idx = [order.index(n) for n in REQUIRED_README_SECTIONS]
    assert idx == sorted(idx), order


def test_readme_credits_is_last_h2():
    order = [h for lvl, h in headings(README_TEXT) if lvl == 2]
    assert order[-1].startswith("Credits")


def test_readme_no_upstream_marketing_sections():
    low = README_TEXT.lower()
    for bad in ("star history", "readme_zh", "readme_ja", "discord", "wechat", "feishu group",
                "shields.io", "img.shields", "frontend.mp4", "cli.mp4", "assets/feature-"):
        assert bad not in low, bad


@pytest.mark.parametrize("phrase", [
    "OKX", "CCXT", "Binance", "futures", "forex", "options",
    "P&L", "positions", "equity curve", "trade history",
    "read-only", "MetaMask", "Windows", "macOS", "Linux",
])
def test_readme_what_you_can_do_bullets(phrase):
    body = README_SECTIONS["What you can do"]
    assert phrase.lower() in body.lower(), phrase


def test_readme_what_you_can_do_covers_equity_markets_and_intervals():
    body = README_SECTIONS["What you can do"]
    assert re.search(r"\bUS\b", body) and re.search(r"\bHK\b", body)
    assert re.search(r"China|\bCN\b", body)
    assert re.search(r"1 ?m(inute)?\b", body) and re.search(r"1 ?(M|month)\b", body)
    bullets = [l for l in body.splitlines() if l.startswith("- ")]
    assert len(bullets) >= 6


def test_readme_quick_start_commands():
    body = README_SECTIONS["Quick start"]
    assert "Python 3.11" in body and "Node 22" in body
    code = "\n".join(code_blocks(body))
    for cmd in (
        "git clone https://github.com/buckleson/vibe-trading-crypto",
        "cd vibe-trading-crypto",
        "python -m venv .venv",
        ". .venv/bin/activate",
        "pip install -e .",
        "vibe-crypto init",
        "vibe-crypto serve",
        "cd frontend && npm install && npm run dev",
    ):
        assert cmd in code, cmd
    assert "http://127.0.0.1:8899" in body


def test_readme_quick_start_has_windows_activation():
    body = README_SECTIONS["Quick start"]
    assert re.search(r"\.venv\\Scripts\\Activate(\.ps1)?", body)


def test_readme_quick_start_ports_match_config():
    vite = read(REPO / "frontend" / "vite.config.ts")
    body = README_SECTIONS["Quick start"]
    assert "8899" in vite and "8899" in body
    m = re.search(r"localhost:(\d+)", body)
    if m:
        assert f"port: {m.group(1)}" in vite


def test_readme_desktop_section_links_desktop_readme():
    body = README_SECTIONS["Desktop app"]
    assert "desktop/electron/README.md" in body
    assert (REPO / "desktop/electron/README.md").is_file()
    code = "\n".join(code_blocks(body))
    assert "cd desktop/electron" in code and "npm install" in code and "npm start" in code


def test_readme_desktop_npm_scripts_exist():
    pkg = json.loads(read(REPO / "desktop/electron/package.json"))
    scripts = pkg["scripts"]
    body = README_SECTIONS["Desktop app"]
    for s in re.findall(r"npm run ([\w:-]+)", body):
        assert s in scripts, s
    assert "start" in scripts


def test_readme_use_with_claude_three_ways():
    body = README_SECTIONS["Use with Claude"]
    numbered = re.findall(r"^\d\. ", body, flags=re.M)
    assert len(numbered) == 3
    assert "Ctrl+J" in body and "Cmd+J" in body
    assert "ANTHROPIC_API_KEY" in body and "Claude Code" in body
    assert "claude mcp add vibe-crypto -- vibe-crypto-mcp" in body
    assert "docs/vibe-crypto/CLAUDE_CODE.md" in body
    assert "terminal" in body.lower()
    assert re.search(r"cannot place live orders|never .*live order", body, flags=re.I)


def test_readme_claude_shortcut_matches_ui():
    layout = read(REPO / "frontend/src/components/layout/Layout.tsx")
    assert '=== "j"' in layout and "metaKey" in layout and "ctrlKey" in layout


def test_readme_paper_trading_section():
    body = README_SECTIONS["Paper trading"]
    lines = [l for l in body.splitlines() if l.strip()]
    assert 3 <= len(lines) <= 10, "paper trading should be short (about 5 lines)"
    low = body.lower()
    for word in ("p&l", "positions", "equity curve", "trade history"):
        assert word in low, word
    assert re.search(r"\bUS\b", body) and re.search(r"\bHK\b", body) and "China A-share" in body
    assert re.search(r"no orders (are )?(ever )?sent", low)
    assert "scheduler" in low  # states the no-background-scheduler limit


def test_readme_paper_refresh_interval_matches_ui():
    """README says the UI refreshes every 5 minutes; the client constant must agree."""
    body = README_SECTIONS["Paper trading"]
    m = re.search(r"every (\d+) minutes", body)
    assert m
    minutes = int(m.group(1))
    srcs = list((REPO / "frontend/src").rglob("*.ts*"))
    pattern = re.compile(
        rf"\b{minutes}\s*\*\s*60\s*\*\s*1_?000\b|\b{minutes}\s*\*\s*60_000\b"
        rf"|\b{minutes * 60_000}\b|\b{minutes * 60}_000\b|\b{minutes * 60}\s*\*\s*1_?000\b"
    )
    hits = [p for p in srcs if "paper" in p.as_posix().lower() and pattern.search(read(p))]
    assert hits, "no 5 minute refresh constant found in paper UI sources"


def test_readme_configuration_section():
    body = README_SECTIONS["Configuration"]
    for s in ("~/.vibe-trading/.env", "agent/.env", "agent/.env.example", "VIBE_TRADING_"):
        assert s in body, s
    assert (REPO / "agent/.env.example").is_file()
    assert "compatib" in body.lower()
    assert re.search(r"provider", body, flags=re.I)
    assert re.search(r"data source", body, flags=re.I)


def test_readme_security_model_section():
    body = README_SECTIONS["Security model"]
    low = body.lower()
    assert "single-user" in low and "no login" in low
    assert "this computer" in low
    assert "cross-site" in low
    assert "live order" in low and "claude" in low
    assert "VIBE_TRADING_ENABLE_SHELL_TOOLS" in body and "off" in low
    assert "VIBE_TRADING_TRUST_DOCKER_LOOPBACK=1" in body
    assert "docs/vibe-crypto/ADR/0002-remove-auth.md" in body


def test_readme_security_model_matches_code_defaults():
    """Shell tools default off and the docker loopback flag is real in code."""
    hits_shell = files_containing("VIBE_TRADING_ENABLE_SHELL_TOOLS")
    hits_docker = files_containing("VIBE_TRADING_TRUST_DOCKER_LOOPBACK")
    assert any(h.startswith("agent/src") for h in hits_shell)
    assert any(h.startswith("agent/src") for h in hits_docker)


def test_readme_development_section():
    body = README_SECTIONS["Development"]
    code = "\n".join(code_blocks(body))
    assert "python -m pytest agent/tests/" in code
    assert "cd frontend && npx vitest run" in code
    assert "docs/vibe-crypto" in body
    table_paths = re.findall(r"^\| `([^`]+)` \|", body, flags=re.M)
    assert len(table_paths) >= 5
    for p in table_paths:
        assert (REPO / p.rstrip("/")).exists(), p


def test_readme_development_test_file_exists():
    for p in re.findall(r"agent/tests/[\w/]+\.py", README_SECTIONS["Development"]):
        assert (REPO / p).is_file(), p


def test_readme_disclaimer():
    low = README_SECTIONS["Disclaimer"].lower()
    assert "not financial advice" in low
    assert "research and education" in low
    assert "paper" in low and "guarantee" in low


def test_readme_credits():
    body = README_SECTIONS["Credits"]
    assert "https://github.com/HKUDS/Vibe-Trading" in body
    assert "MIT" in body
    assert "](LICENSE)" in body and "](NOTICE)" in body
    assert "frontend/public/fonts/LICENSE" in body
    assert (REPO / "frontend/public/fonts/LICENSE").is_file()
    assert (REPO / "LICENSE").is_file() and (REPO / "NOTICE").is_file()


def test_license_and_notice_keep_upstream_attribution():
    assert "Vibe-Trading" in read(REPO / "LICENSE") or "HKUDS" in read(REPO / "LICENSE")
    assert "HKUDS" in read(REPO / "NOTICE") or "Vibe-Trading" in read(REPO / "NOTICE")


def test_readme_repo_urls_point_to_fork():
    urls = re.findall(r"https://github\.com/[\w.-]+/[\w.-]+", README_TEXT)
    for u in urls:
        assert u.startswith("https://github.com/buckleson/vibe-trading-crypto") or \
            u == "https://github.com/HKUDS/Vibe-Trading", u


def test_readme_images_only_existing_assets():
    imgs = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", README_TEXT)
    imgs += re.findall(r'<img[^>]+src="([^"]+)"', README_TEXT)
    for src in imgs:
        assert not src.startswith("http"), src
        assert (REPO / src).is_file(), src


def test_readme_no_em_dash_outside_generated_block():
    assert EM_DASH not in strip_generated(README_TEXT)


def test_readme_no_emoji():
    assert not EMOJI_RE.search(README_TEXT)


def test_readme_headings_sentence_case():
    bad = [h for _, h in headings(strip_generated(README_TEXT)) if not is_sentence_case(h)]
    assert not bad, bad


def test_readme_no_marketing_superlatives():
    low = strip_code(README_TEXT).lower()
    for w in ("blazing", "revolutionary", "world-class", "best-in-class", "cutting-edge",
              "state-of-the-art", "game-changing", "seamless", "powerful"):
        assert w not in low, w


def test_readme_no_auth_instructions():
    for bad in ("API_AUTH_KEY", "Bearer", "Authorization:", "SSE ticket", "auth key"):
        assert bad not in README_TEXT, bad


def test_readme_keeps_generated_capability_block_once():
    assert README_TEXT.count(GEN_BEGIN) == 1 and README_TEXT.count(GEN_END) == 1
    assert README_TEXT.index(GEN_BEGIN) < README_TEXT.index(GEN_END)


# --------------------------------------------------------------------------- links


LINK_DOCS = [
    README, SECURITY, CONTRIBUTING, AGENT_GUIDE, HANDOFF, TODO, T14_NOTE,
    *sorted(GUIDES.glob("*.md")),
]


@pytest.mark.parametrize("doc", LINK_DOCS, ids=lambda p: p.relative_to(REPO).as_posix())
def test_relative_links_resolve(doc):
    text = read(doc)
    if doc.name == "news.md":
        text = text.split("\n## ", 1)[0]  # entries are upstream history
    broken = []
    for href in md_links(text):
        if re.match(r"^(https?:|mailto:|#)", href):
            continue
        path = href.split("#", 1)[0]
        if not path:
            continue
        if not (doc.parent / path).resolve().exists():
            broken.append(href)
    assert not broken, broken


def test_relative_anchor_to_security_defaults_exists():
    text = read(GUIDES / "installation.md")
    if "cli-and-api.md#security-defaults" in text:
        assert "### Security defaults" in read(GUIDES / "cli-and-api.md")


# --------------------------------------------------------------------------- CLI facts


def _vibe_crypto_bin() -> str | None:
    venv = REPO / ".venv" / ("Scripts" if os.name == "nt" else "bin") / "vibe-crypto"
    if venv.exists():
        return str(venv)
    return shutil.which("vibe-crypto")


def _run_cli(*args: str) -> subprocess.CompletedProcess:
    exe = _vibe_crypto_bin()
    if exe is None:
        pytest.skip("vibe-crypto not installed")
    env = dict(os.environ)
    env.setdefault("NO_COLOR", "1")
    return subprocess.run([exe, *args], capture_output=True, text=True, timeout=120, env=env)


@pytest.fixture(scope="module")
def cli_help() -> str:
    res = _run_cli("--help")
    assert res.returncode == 0, res.stderr
    return res.stdout


@pytest.mark.parametrize("sub", ["init", "setup", "serve", "mcp"])
def test_readme_cli_subcommands_exist(cli_help, sub):
    assert sub in README_TEXT
    assert re.search(rf"\b{sub}\b", cli_help.split("positional arguments")[0]), sub


def test_serve_has_port_flag():
    res = _run_cli("serve", "--help")
    assert res.returncode == 0
    assert "--port" in res.stdout
    assert "--port" in README_TEXT


def test_mcp_subcommands_match_docs():
    res = _run_cli("mcp", "--help")
    assert res.returncode == 0
    for sub in ("config", "install"):
        assert sub in res.stdout
        assert f"vibe-crypto mcp {sub}" in README_TEXT


def test_mcp_config_prints_json_with_vibe_crypto_server(tmp_path):
    res = _run_cli("mcp", "config")
    assert res.returncode == 0, res.stderr
    data = json.loads(res.stdout)
    servers = data["mcpServers"]
    assert "vibe-crypto" in servers
    assert "vibe-crypto-mcp" in json.dumps(servers["vibe-crypto"])


def test_cli_help_has_no_old_brand(cli_help):
    assert "Vibe-Trading" not in cli_help
    assert "usage: vibe-crypto" in cli_help


# --------------------------------------------------------------------------- guides


MCP_TOKEN_GUIDES = {"share-with-friends.md", "mcp.md"}
GUIDE_FILES = sorted(p for p in GUIDES.glob("*.md") if p.name != "news.md")


@pytest.mark.parametrize("guide", GUIDE_FILES, ids=lambda p: p.name)
def test_guides_have_no_auth_key_instructions(guide):
    text = read(guide)
    # The remote MCP token (ADR 0008) is documented with the Bearer header form.
    if guide.name in MCP_TOKEN_GUIDES:
        text = text.replace("Authorization: Bearer <token>", "")
    for bad in ("API_AUTH_KEY", "Authorization: Bearer", "Bearer <", "Bearer token",
                "SSE ticket", "/auth/sse-ticket", "sse_ticket", "enter the key in Settings",
                "X-API-Key"):
        assert bad not in text, bad


@pytest.mark.parametrize("guide", GUIDE_FILES, ids=lambda p: p.name)
def test_guides_have_no_bearer_word(guide):
    text = read(guide)
    if guide.name in MCP_TOKEN_GUIDES:
        text = text.replace("Authorization: Bearer <token>", "")
    assert not re.search(r"\bBearer\b", text)


@pytest.mark.parametrize("guide", GUIDE_FILES, ids=lambda p: p.name)
def test_guides_use_new_cli_names(guide):
    text = read(guide)
    # Old command names must not be presented as commands.
    assert not re.search(r"(^|[\s`$])vibe-trading-mcp\b", text, flags=re.M)
    assert not re.search(r"(^|[\s`$])vibe-trading (serve|init|run|mcp|setup|chat)\b", text, flags=re.M)
    assert "pip install vibe-trading-ai" not in text


def test_guides_mention_vibe_crypto_commands():
    allg = "\n".join(read(p) for p in GUIDE_FILES)
    assert "vibe-crypto serve" in allg
    assert "vibe-crypto-mcp" in allg
    assert "vibe-crypto init" in read(GUIDES / "installation.md")


def test_installation_guide_fixes_clone_folder():
    text = read(GUIDES / "installation.md")
    assert "cd Vibe Crypto" not in text
    assert "cd vibe-trading-crypto" in text


def test_installation_guide_docker_local_only():
    text = read(GUIDES / "installation.md")
    assert "127.0.0.1" in text
    assert "VIBE_TRADING_TRUST_DOCKER_LOOPBACK=1" in text
    assert re.search(r"remote access is not supported", text, flags=re.I)


def test_docker_compose_matches_docs():
    compose = read(REPO / "docker-compose.yml")
    assert '"127.0.0.1:8899:8899"' in compose
    assert "VIBE_TRADING_TRUST_DOCKER_LOOPBACK=1" in compose


CLI_API = read(GUIDES / "cli-and-api.md")
CLI_API_H3 = sections(CLI_API, level=3)


def test_api_guide_documents_paper_runs_section():
    assert "Paper runs" in CLI_API_H3
    body = CLI_API_H3["Paper runs"]
    for method, path in [
        ("POST", "/api/paper-runs"),
        ("GET", "/api/paper-runs"),
        ("GET", "/api/paper-runs/{id}"),
        ("POST", "/api/paper-runs/{id}/refresh"),
        ("POST", "/api/paper-runs/{id}/stop"),
        ("DELETE", "/api/paper-runs/{id}"),
    ]:
        assert re.search(rf"\| `{method}` \| `{re.escape(path)}` \|", body), (method, path)


def _app_routes():
    import api_server  # noqa: E402
    out = set()
    for r in api_server.app.routes:
        for m in getattr(r, "methods", None) or ():
            out.add((m, r.path))
    return out


@pytest.fixture(scope="module")
def app_routes():
    try:
        return _app_routes()
    except Exception as exc:  # pragma: no cover - environment specific
        pytest.skip(f"api_server import failed: {exc}")


def test_documented_paper_routes_exist_in_app(app_routes):
    body = CLI_API_H3["Paper runs"]
    rows = re.findall(r"\| `(GET|POST|DELETE|PUT|PATCH)` \| `(/api/[^`]+)` \|", body)
    assert len(rows) == 6
    for method, path in rows:
        real = path.replace("{id}", "{paper_id}")
        assert (method, real) in app_routes or (method, path) in app_routes, (method, path)


def test_all_paper_run_routes_in_app_are_documented(app_routes):
    body = CLI_API_H3["Paper runs"]
    real = {(m, p) for m, p in app_routes if p.startswith("/api/paper-runs") and m != "HEAD"}
    assert real
    for m, p in real:
        doc = p.replace("{paper_id}", "{id}")
        assert f"`{m}` | `{doc}`" in body, (m, p)


def test_api_guide_documents_paper_run_errors_and_fields():
    body = CLI_API_H3["Paper runs"]
    assert "404" in body and "422" in body
    for f in ("evaluation_start", "status", "state", "summary", "initial_cash", "warmup_days"):
        assert f in body, f
    assert "/api/paper-accounts" in body
    assert "scheduler" in body


def test_paper_run_create_fields_match_route_model():
    src = read(AGENT_DIR / "src/api/paper_trade_routes.py")
    for f in ("run_id", "label", "initial_cash", "warmup_days"):
        assert f in src, f


def test_api_guide_documents_claude_chat():
    assert "Claude chat" in CLI_API_H3
    body = CLI_API_H3["Claude chat"]
    assert re.search(r"\| `GET` \| `/api/claude/status` \|", body)
    assert re.search(r"\| `POST` \| `/api/claude/chat` \|", body)
    assert "ANTHROPIC_API_KEY" in body
    assert "docs/vibe-crypto/CLAUDE_CODE.md" in body


def test_documented_claude_routes_exist_in_app(app_routes):
    assert ("GET", "/api/claude/status") in app_routes
    assert ("POST", "/api/claude/chat") in app_routes


SSE_TYPES = ["session", "text", "tool_use", "tool_result", "done", "error"]


@pytest.mark.parametrize("etype", SSE_TYPES)
def test_api_guide_lists_sse_event_type(etype):
    body = CLI_API_H3["Claude chat"]
    assert re.search(rf"^\| `{etype}` \|", body, flags=re.M), etype


def test_sse_event_types_doc_matches_service_exactly():
    src = read(AGENT_DIR / "src/claude_chat/service.py")
    code_types = set(re.findall(r'"type":\s*"([a-z_]+)"', src))
    code_types = {t for t in code_types if t not in {"stdio", "content_block_delta", "text_delta"}}
    body = CLI_API_H3["Claude chat"]
    doc_types = set(re.findall(r"^\| `([a-z_]+)` \|", body, flags=re.M))
    assert doc_types == code_types == set(SSE_TYPES)


@pytest.mark.parametrize("etype,fields", [
    ("session", ["session_id"]),
    ("text", ["delta"]),
    ("tool_use", ["id", "name", "input"]),
    ("tool_result", ["tool_use_id", "is_error", "preview"]),
    ("done", ["session_id", "is_error", "cost_usd", "duration_ms"]),
    ("error", ["message"]),
])
def test_sse_event_fields_documented_and_emitted(etype, fields):
    body = CLI_API_H3["Claude chat"]
    row = re.search(rf"^\| `{etype}` \|(.*)$", body, flags=re.M).group(1)
    src = read(AGENT_DIR / "src/claude_chat/service.py")
    for f in fields:
        assert f"`{f}`" in row, (etype, f)
        assert f'"{f}"' in src, (etype, f)


def test_claude_status_fields_documented():
    body = CLI_API_H3["Claude chat"]
    for f in ("available", "sdk_version", "auth", "model", "error"):
        assert f'"{f}"' in body
    for a in ("api_key", "claude_login", "unknown"):
        assert f"`{a}`" in body
        assert f'"{a}"' in read(AGENT_DIR / "src/claude_chat/service.py")


def test_api_guide_security_defaults_local_only():
    body = CLI_API_H3["Security defaults"]
    low = body.lower()
    assert "no login" in low
    assert "403" in body
    assert "remote access" in low and "not supported" in low
    assert "0002-remove-auth.md" in body


def test_mcp_guide_points_to_claude_code_doc():
    text = read(GUIDES / "mcp.md")
    assert "docs/vibe-crypto/CLAUDE_CODE.md" in text
    assert "claude mcp add vibe-crypto -- vibe-crypto-mcp" in text
    assert (DOCS / "CLAUDE_CODE.md").is_file()


@pytest.fixture(scope="module")
def mcp_tool_names():
    try:
        import mcp_server  # noqa: E402
        from fastmcp import Client
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"mcp_server import failed: {exc}")

    async def _list():
        async with Client(mcp_server.mcp) as c:
            return sorted(t.name for t in await c.list_tools())

    return asyncio.run(_list())


def test_mcp_guide_tool_count_matches_server(mcp_tool_names):
    text = read(GUIDES / "mcp.md")
    n = len(mcp_tool_names)
    counts: set[int] = set()
    for a, b in re.findall(r"(\d+) MCP tools|MCP tools exposed \((\d+)\)", text):
        counts.add(int(a or b))
    assert counts == {n}, (counts, n)


def test_mcp_guide_tool_list_matches_server(mcp_tool_names):
    text = read(GUIDES / "mcp.md")
    m = re.search(r"\*\*MCP tools exposed \(\d+\):\*\*(.*)", text)
    assert m
    listed = re.findall(r"`([a-z_]+)`", m.group(1))
    assert len(listed) == len(set(listed)), "duplicate tool in list"
    assert sorted(listed) == mcp_tool_names


def test_capabilities_guide_tool_count_matches(mcp_tool_names):
    text = read(GUIDES / "capabilities.md")
    for n in re.findall(r"MCP server[^\n]*?(\d+) tools", text):
        assert int(n) == len(mcp_tool_names)


def test_mcp_tools_include_paper_runs_and_no_live_order_tool(mcp_tool_names):
    for t in ("paper_run_list", "paper_run_start", "paper_run_status", "paper_run_stop"):
        assert t in mcp_tool_names
    for t in mcp_tool_names:
        assert not re.search(r"place_order|submit_order|live_order|trading_order_place", t), t


def test_news_guide_has_upstream_note_first():
    text = read(GUIDES / "news.md")
    body = [l for l in text.splitlines() if l.strip()]
    assert body[0].startswith("# ")
    assert body[1].startswith("> ")
    assert "upstream" in body[1].lower() and "before the fork" in body[1].lower()


def _git_head(path: str) -> str | None:
    if shutil.which("git") is None:
        return None
    res = subprocess.run(["git", "-C", str(REPO), "show", f"HEAD:{path}"],
                         capture_output=True, text=True)
    return res.stdout if res.returncode == 0 else None


def test_news_guide_entries_untouched():
    head = _git_head("guides/news.md")
    if head is None:
        pytest.skip("git HEAD blob not available")

    def entries(t: str) -> str:
        return t[t.index("\n## "):] if "\n## " in t else t

    assert entries(read(GUIDES / "news.md")) == entries(head)


# --------------------------------------------------------------------------- root docs


def test_security_md_private_advisory_on_fork():
    text = read(SECURITY)
    assert "https://github.com/buckleson/vibe-trading-crypto/security/advisories/new" in text
    assert "HKUDS/Vibe-Trading" not in text


def test_security_md_local_model_section():
    sec = sections(read(SECURITY))
    body = sec.get("Local security model", "")
    assert body, "missing ## Local security model"
    low = body.lower()
    for s in ("single-user", "no login", "this computer", "403", "host", "cross-site",
              "live order", "claude"):
        assert s in low, s
    assert "VIBE_TRADING_TRUST_DOCKER_LOOPBACK=1" in body
    assert "VIBE_TRADING_ENABLE_SHELL_TOOLS" in body
    assert "0002-remove-auth.md" in body
    assert EM_DASH not in body and not EMOJI_RE.search(body)


def test_security_md_no_api_key_auth():
    text = read(SECURITY)
    assert "API_AUTH_KEY" not in text and not re.search(r"\bBearer\b", text)


def test_security_md_no_emoji():
    """T14 rewrote SECURITY.md; the docs rule bans emoji (a check mark remains upstream)."""
    assert not EMOJI_RE.search(read(SECURITY)), EMOJI_RE.findall(read(SECURITY))


def test_security_md_no_em_dash():
    assert EM_DASH not in read(SECURITY)


@pytest.mark.parametrize("doc", [CONTRIBUTING, AGENT_GUIDE], ids=lambda p: p.name)
def test_contributor_docs_fork_conventions(doc):
    text = read(doc)
    assert "https://github.com/buckleson/vibe-trading-crypto" in text
    assert "docs/vibe-crypto" in text
    assert "ADR" in text and "handoff" in text
    assert "defaultValue" in text
    assert "cook/BRIEF.md" in text
    assert re.search(r"(python -m )?pytest agent/tests/", text)
    assert "npx vitest run" in text


@pytest.mark.parametrize("doc", [CONTRIBUTING, AGENT_GUIDE], ids=lambda p: p.name)
def test_contributor_docs_no_auth_key_rule(doc):
    text = read(doc)
    assert "API_AUTH_KEY" not in text
    assert not re.search(r"\bBearer\b", text)
    assert "github.com/HKUDS/Vibe-Trading/" not in text


@pytest.mark.parametrize("doc,section", [
    (CONTRIBUTING, "Fork documentation conventions"),
    (AGENT_GUIDE, None),
], ids=["CONTRIBUTING.md", "AGENT_CONTRIBUTOR_GUIDE.md"])
def test_contributor_docs_referenced_paths_exist(doc, section):
    """Paths in text T14 wrote must exist (upstream CONTRIBUTING sections are out of scope)."""
    text = read(doc) if section is None else sections(read(doc))[section]
    for p in set(re.findall(r"`((?:agent|frontend|desktop|docs|tools|cook)/[\w./-]+\.\w+)`", text)):
        if "<" in p or "*" in p or "NNNN" in p:
            continue
        assert (REPO / p).exists(), p


def test_contributing_fork_section_sentence_case_and_clean():
    sec = sections(read(CONTRIBUTING))
    body = sec.get("Fork documentation conventions")
    assert body
    assert EM_DASH not in body and not EMOJI_RE.search(body)


# --------------------------------------------------------------------------- assets


DELETED_ASSETS = [
    "Frontend.mp4",
    "cli.mp4",
    "pip-install.svg",
    "feature-cross-market-data-backtesting.png",
    "feature-market-research-card.svg",
    "feature-multi-agent-trading-teams.png",
    "feature-quant-lab-card.svg",
    "feature-research-teams-card.svg",
    "feature-self-improving-trading-agent.png",
    "feature-shadow-account.png",
    "feature-trading-portfolio-card.svg",
]


def test_icons_kept():
    assert (ASSETS / "icon.png").is_file() and (ASSETS / "icon.png").stat().st_size > 0
    assert (ASSETS / "icon.svg").is_file() and (ASSETS / "icon.svg").stat().st_size > 0
    assert read(ASSETS / "icon.svg").lstrip().startswith(("<svg", "<?xml"))
    assert (ASSETS / "icon.png").read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_assets_dir_contains_only_icons_or_referenced_files():
    for p in ASSETS.rglob("*"):
        if p.is_dir():
            continue
        rel = p.relative_to(ASSETS).as_posix()
        if rel in {"icon.png", "icon.svg"}:
            continue
        assert files_containing(p.name), f"unreferenced asset {rel}"


@pytest.mark.parametrize("name", DELETED_ASSETS)
def test_upstream_asset_deleted(name):
    assert not (ASSETS / name).exists()


def test_no_feature_glob_or_features_dir_left():
    assert not list(ASSETS.glob("feature-*"))
    assert not (ASSETS / "features").exists()


@pytest.fixture(scope="module")
def repo_text_corpus():
    corpus = {}
    for p in iter_repo_text_files():
        rel = p.relative_to(REPO).as_posix()
        try:
            corpus[rel] = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            pass
    return corpus


# Records of the deletion itself may name the files.
DELETION_RECORDS = ("docs/vibe-crypto/",)


@pytest.mark.parametrize("name", DELETED_ASSETS)
def test_no_dangling_reference_to_deleted_asset(repo_text_corpus, name):
    hits = [rel for rel, text in repo_text_corpus.items()
            if name in text and not rel.startswith(DELETION_RECORDS)
            and not rel.startswith("agent/tests/vibe_crypto/test_T14")]
    assert not hits, hits


def test_no_reference_to_assets_features_dir(repo_text_corpus):
    hits = [rel for rel, text in repo_text_corpus.items()
            if re.search(r"assets/features(?!/(ar|es|id|ja|ko|zh))", text)
            and not rel.startswith(DELETION_RECORDS)
            and not rel.startswith("agent/tests/vibe_crypto/")]
    assert not hits, hits


def test_icon_files_still_referenced(repo_text_corpus):
    assert any("icon.png" in t for r, t in repo_text_corpus.items() if not r.startswith("docs/"))


# --------------------------------------------------------------------------- grep checks


API_AUTH_KEY_ALLOWED = (
    "CHANGELOG.md",
    "guides/news.md",
    "docs/vibe-crypto/",
    "desktop/electron/THREAT_MODEL.md",
    "desktop/electron/src/backend-manager.ts",  # scrubs the var from the child env
    "agent/tests/",
    "desktop/electron/scripts/test-",
    "frontend/src/__tests__/",
    "agent/src/backtest/runner_env",  # secret scrub lists, if any
)


def test_api_auth_key_only_in_history_and_scrub_lists(repo_text_corpus):
    hits = sorted(rel for rel, text in repo_text_corpus.items() if "API_AUTH_KEY" in text)
    bad = [h for h in hits if not h.startswith(API_AUTH_KEY_ALLOWED)]
    assert not bad, bad


def test_backend_manager_only_deletes_api_auth_key():
    text = read(REPO / "desktop/electron/src/backend-manager.ts")
    lines = [l.strip() for l in text.splitlines() if "API_AUTH_KEY" in l]
    assert lines and all(l.startswith("delete ") for l in lines), lines


OLD_BRAND_ALLOWED = (
    "NOTICE", "LICENSE", "CHANGELOG.md", "README.md", "pyproject.toml",
    "guides/news.md",
    "docs/vibe-crypto/",
    "agent/src/channels/websocket.py",  # X-Vibe-Trading-Auth header (risk 17)
    "frontend/src/i18n/locales/",       # help strings for that header
    "agent/tests/vibe_crypto/",
    "frontend/src/__tests__/vibe-crypto/",
    "desktop/electron/scripts/test-rebrand",
)


def test_old_brand_only_in_attribution_or_history(repo_text_corpus):
    hits = sorted(rel for rel, text in repo_text_corpus.items() if "Vibe-Trading" in text)
    bad = [h for h in hits if not h.startswith(OLD_BRAND_ALLOWED)]
    assert not bad, bad


def test_readme_old_brand_only_in_credits():
    for name, body in README_SECTIONS.items():
        if name.startswith("Credits"):
            continue
        assert "Vibe-Trading" not in body, name
    assert "Vibe-Trading" not in README_TEXT.split("\n## ", 1)[0]


def test_locale_old_brand_only_in_websocket_header_help():
    for p in (REPO / "frontend/src/i18n/locales").glob("*.json"):
        for line in read(p).splitlines():
            if "Vibe-Trading" in line:
                assert "X-Vibe-Trading-Auth" in line, (p.name, line)


def test_pyproject_old_brand_only_attribution():
    for line in read(REPO / "pyproject.toml").splitlines():
        if "Vibe-Trading" in line:
            assert "upstream" in line.lower() or "HKUDS" in line, line


# --------------------------------------------------------------------------- HANDOFF


HANDOFF_TEXT = read(HANDOFF)
HANDOFF_H2 = sections(HANDOFF_TEXT)


@pytest.mark.parametrize("name", [
    "Current state", "How to run", "Where things live", "Open risks and follow-ups", "Task log",
])
def test_handoff_has_section(name):
    match = [k for k in HANDOFF_H2 if k.startswith(name)]
    assert match, name
    assert HANDOFF_H2[match[0]].strip()


def _h2(prefix: str) -> str:
    return next(v for k, v in HANDOFF_H2.items() if k.startswith(prefix))





def test_handoff_verification_results_have_numbers():
    body = _h2("Current state")
    table = [l for l in body.splitlines() if l.startswith("| ") and "---" not in l][1:]
    assert len(table) >= 8
    for row in table:
        result = row.rstrip("|").split("|")[-1].strip()
        assert result, row
    assert re.search(r"\d+ passed", body)


def test_handoff_how_to_run_commands():
    body = _h2("How to run")
    for s in ("vibe-crypto serve", "npm start", "Windows", "macOS", "Linux",
              "claude mcp add vibe-crypto -- vibe-crypto-mcp", "Ctrl/Cmd+J",
              "ANTHROPIC_API_KEY", "Terminal"):
        assert s in body, s
    assert re.search(r"\.venv\\Scripts\\Activate", body)


def test_handoff_where_things_live_paths_exist():
    body = _h2("Where things live")
    for needle in ("paper_runs", "claude_chat", "components/ui", "terminal"):
        assert needle in body, needle
    paths = re.findall(r"`((?:agent|frontend|desktop|guides|docs)/[^`*]+?)`", body)
    assert len(paths) >= 10
    missing = [p for p in paths if not (REPO / p.rstrip("/")).exists()]
    assert not missing, missing


def test_handoff_open_risks_table_complete():
    body = _h2("Open risks")
    rows = re.findall(r"^\| (\d+) \|(.+)$", body, flags=re.M)
    assert len(rows) >= 10
    nums = [int(n) for n, _ in rows]
    assert nums == list(range(1, len(nums) + 1)), "risk numbers not sequential"
    for n, rest in rows:
        cells = [c.strip() for c in rest.rstrip("|").split("|")]
        assert len(cells) == 3, (n, cells)
        assert all(cells), (n, cells)  # risk, owner area, next step all filled


def test_handoff_open_risks_deduplicated():
    body = _h2("Open risks")
    risks = [r.split("|")[0].strip().lower() for _, r in
             re.findall(r"^\| (\d+) \|(.+)$", body, flags=re.M)]
    assert len(risks) == len(set(risks))


@pytest.mark.parametrize("keyword", [
    "node-pty",            # T11
    "scheduler",           # T04/T05
    "claude-agent-sdk",    # lock files (T06)
    "mocked",              # paper runs / chat
    "vc:open-dock",        # T09
    ".gitignore",          # docs/ ignored
    "test_readme_counts",  # T14 edit outside paths
    "em dash",             # generated table
    "unsigned",            # T11 macOS
    "MetaMask",            # T12
    "X-Vibe-Trading-Auth", # T02/T13 leftovers
    "VIBE_TRADING_",       # compat names
])
def test_handoff_open_risks_mention(keyword):
    body = _h2("Open risks")
    assert keyword.lower() in body.lower(), keyword


def test_handoff_risk_references_are_valid():
    """Every 'risk N' cited anywhere in the docs points at an existing row."""
    body = _h2("Open risks")
    n = len(re.findall(r"^\| \d+ \|", body, flags=re.M))
    for doc in (HANDOFF, TODO, T14_NOTE):
        for ref in re.findall(r"risks? (\d+)(?: and (\d+))?", read(doc)):
            for r in ref:
                if r:
                    assert 1 <= int(r) <= n, (doc.name, r)


def test_handoff_task_log_rows():
    body = _h2("Task log")
    rows = re.findall(r"^\| (T\d\d) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$", body, flags=re.M)
    ids = [r[0] for r in rows]
    assert ids == [f"T{i:02d}" for i in range(1, 19)]
    for tid, title, status, link in rows:
        assert title.strip()
        assert re.match(r"(done|partial)\b", status.strip()), (tid, status)
        m = re.search(r"\]\(([^)]+)\)", link)
        assert m and m.group(1) == f"handoff/{tid}.md", (tid, link)
        assert (DOCS / m.group(1)).is_file(), tid


def test_handoff_partial_statuses_cite_a_risk():
    body = _h2("Task log")
    for line in body.splitlines():
        if "| partial" in line:
            assert re.search(r"risk \d+", line), line


def test_handoff_files_kept_for_every_task():
    for i in range(1, 15):
        assert (DOCS / "handoff" / f"T{i:02d}.md").is_file(), i


def test_handoff_no_em_dash_or_emoji():
    assert EM_DASH not in HANDOFF_TEXT
    assert not EMOJI_RE.search(HANDOFF_TEXT)


def test_handoff_headings_sentence_case():
    bad = [h for _, h in headings(HANDOFF_TEXT) if not is_sentence_case(h)]
    assert not bad, bad


def test_handoff_mcp_tool_count_matches_server(mcp_tool_names):
    for n in re.findall(r"(\d+) MCP tools", HANDOFF_TEXT):
        assert int(n) == len(mcp_tool_names)


def test_handoff_risk_test_readme_counts_is_skipped_as_described():
    text = read(AGENT_DIR / "tests/test_readme_counts.py")
    assert "pytest.skip(" in text and "allow_module_level=True" in text


# --------------------------------------------------------------------------- TODO


TODO_TEXT = read(TODO)
CHECK_RE = re.compile(r"^- \[( |x)\] (.+)$", re.M)


def test_todo_checkbox_syntax_valid():
    for line in TODO_TEXT.splitlines():
        if line.lstrip().startswith("- ["):
            assert re.match(r"^- \[( |x)\] \S", line), line





def test_todo_sections_cover_all_tasks():
    for i in range(1, 15):
        assert f"### T{i:02d} " in TODO_TEXT, i


def test_todo_no_em_dash_or_emoji():
    assert EM_DASH not in TODO_TEXT and not EMOJI_RE.search(TODO_TEXT)


# Ticked items backed by concrete repo facts.
TICK_EVIDENCE = [
    ("Delete `auth_routes.py`", lambda: not (AGENT_DIR / "src/api/auth_routes.py").exists()),
    ("delete `lib/apiAuth.ts`", lambda: not (REPO / "frontend/src/lib/apiAuth.ts").exists()),
    ("`agent/src/paper_runs/` service", lambda: (AGENT_DIR / "src/paper_runs/service.py").is_file()),
    ("Routes `/api/paper-runs*`",
     lambda: "/api/paper-runs" in read(AGENT_DIR / "src/api/paper_trade_routes.py")),
    ("`lib/paperRuns.ts`", lambda: (REPO / "frontend/src/lib/paperRuns.ts").is_file()),
    ("`agent/src/claude_chat/service.py`",
     lambda: (AGENT_DIR / "src/claude_chat/service.py").is_file()),
    ("`claude-agent-sdk` declared", lambda: "claude-agent-sdk" in read(REPO / "pyproject.toml")),
    ("`lib/claudeChat.ts`", lambda: (REPO / "frontend/src/lib/claudeChat.ts").is_file()),
    ("Project `.mcp.json`", lambda: "vibe-crypto" in read(REPO / ".mcp.json")),
    ("`docs/vibe-crypto/CLAUDE_CODE.md`", lambda: (DOCS / "CLAUDE_CODE.md").is_file()),
    ("`lib/wallet.ts`", lambda: (REPO / "frontend/src/lib/wallet.ts").is_file()),
    ("`components/ui/` primitives", lambda: any((REPO / "frontend/src/components/ui").glob("*.tsx"))),
    ("`node-pty` terminal manager",
     lambda: (REPO / "desktop/electron/src/terminal-manager.ts").is_file()),
    ("Remove translated READMEs",
     lambda: not list(REPO.glob("README_*.md")) and not (REPO / "wiki").exists()),
    ("`LICENSE` fork line", lambda: "buckleson" in read(REPO / "LICENSE") or
     "Vibe Crypto" in read(REPO / "LICENSE")),
    ("README rewrite", lambda: README_TEXT.startswith("# Vibe Crypto")),
    ("`HANDOFF.md` merged", lambda: "## Task log" in HANDOFF_TEXT),
]


@pytest.mark.parametrize("needle,check", TICK_EVIDENCE, ids=[n for n, _ in TICK_EVIDENCE])
def test_todo_ticked_items_are_backed_by_repo(needle, check):
    line = next((l for l in TODO_TEXT.splitlines() if needle in l), None)
    assert line is not None, needle
    if line.startswith("- [x]"):
        assert check(), f"ticked but not true in repo: {line}"


def test_todo_mcp_tools_ticked_and_present(mcp_tool_names):
    line = next(l for l in TODO_TEXT.splitlines() if "MCP tools `paper_run_list`" in l)
    if line.startswith("- [x]"):
        for t in re.findall(r"`(paper_run_\w+)`", line):
            assert t in mcp_tool_names


def test_todo_electron_scripts_ticked_and_present():
    pkg = json.loads(read(REPO / "desktop/electron/package.json"))
    line = next(l for l in TODO_TEXT.splitlines() if "electron-builder mac and linux" in l)
    if line.startswith("- [x]"):
        assert any(k.startswith("pack:mac") for k in pkg["scripts"])
        assert any(k.startswith("pack:linux") for k in pkg["scripts"])


# --------------------------------------------------------------------------- T14 note


def test_t14_handoff_note_present_and_clean():
    text = read(T14_NOTE)
    assert text.startswith("# T14")
    for s in ("README.md", "guides/", "assets/", "HANDOFF.md", "test_readme_counts.py"):
        assert s in text, s
    assert EM_DASH not in text and not EMOJI_RE.search(text)
    bad = [h for _, h in headings(text) if not is_sentence_case(h)]
    assert not bad, bad


T14_WRITTEN_GUIDE_SECTIONS = [
    ("cli-and-api.md", 3, "Paper runs"),
    ("cli-and-api.md", 3, "Claude chat"),
    ("cli-and-api.md", 3, "Security defaults"),
]


@pytest.mark.parametrize("fname,level,name", T14_WRITTEN_GUIDE_SECTIONS)
def test_t14_written_guide_sections_clean(fname, level, name):
    body = sections(read(GUIDES / fname), level=level)[name]
    if name == "Security defaults":
        # T14 wrote the intro and the bullet list; the later shell-tools paragraph is upstream.
        body = body.split("\n\nShell-capable", 1)[0]
    assert EM_DASH not in body
    assert not EMOJI_RE.search(body)


def test_news_note_and_mcp_pointer_clean():
    note = [l for l in read(GUIDES / "news.md").splitlines() if l.startswith("> ")][0]
    assert EM_DASH not in note
    ptr = [l for l in read(GUIDES / "mcp.md").splitlines() if "CLAUDE_CODE.md" in l][0]
    assert EM_DASH not in ptr


# --------------------------------------------------------------------------- helper edge cases


@pytest.mark.parametrize("h,ok", [
    ("Quick start", True),
    ("Use with Claude", True),
    ("Quick Start", False),
    ("Desktop app", True),
    ("Security Model", False),
    ("API and MCP setup", True),
    ("", True),
])
def test_sentence_case_helper(h, ok):
    assert is_sentence_case(h) is ok


def test_sections_helper_ignores_headings_in_code():
    text = "## A\nx\n```bash\n## not a heading\n```\n## B\ny\n"
    s = sections(text)
    assert list(s) == ["A", "B"] and "not a heading" in s["A"]


def test_strip_generated_helper_handles_missing_block():
    assert strip_generated("a\nb") == "a\nb"
    assert strip_generated(f"a\n{GEN_BEGIN}\nx\n{GEN_END}\nb") == "a\nb"


def test_emoji_regex_edge_cases():
    assert EMOJI_RE.search("✅")
    assert EMOJI_RE.search("\U0001F680")
    assert not EMOJI_RE.search("P&L -> ok, 1 month, ~/.env")
