"""T01 acceptance tests: repo-wide rebrand to Vibe Crypto (ADR 0001).

Every test here is offline and deterministic. Most are static checks over the
working tree; a few compare against the imported upstream baseline commit
(``git show d19d1ac:<path>``, override with T01_BASELINE_REF) to prove that internal identifiers were NOT renamed
and that attribution text was preserved byte for byte. Those skip cleanly when
git or the baseline is unavailable (for example in an sdist install).
"""

from __future__ import annotations

import ast
import json
import os
import re
import shutil
import subprocess
import sys
import tomllib
from functools import lru_cache
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
AGENT = REPO / "agent"
FRONTEND = REPO / "frontend"
ELECTRON = REPO / "desktop" / "electron"
VENV_BIN = REPO / ".venv" / ("Scripts" if os.name == "nt" else "bin")

FORK_URL = "https://github.com/buckleson/vibe-trading-crypto"
UPSTREAM_URL = "https://github.com/HKUDS/Vibe-Trading"

# Directories never scanned (vendored, generated, or owned by other tasks).
_SKIP_DIR_PARTS = {
    ".git", ".venv", "node_modules", "dist", "__pycache__", ".cache",
    "release", "runtime",
}
_SKIP_PREFIXES = (
    "docs/vibe-crypto/", "cook/", "frontend/public/fonts/",
    # the rebrand test suites themselves quote the old names on purpose
    "agent/tests/vibe_crypto/", "frontend/src/__tests__/vibe-crypto/",
    "desktop/electron/scripts/test-rebrand-T01.mjs",
)
_BINARY_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".icns", ".webp", ".woff",
    ".woff2", ".ttf", ".otf", ".pdf", ".zip", ".gz", ".db", ".sqlite",
    ".parquet", ".pkl", ".npy", ".mp4", ".mov", ".exe", ".dll", ".so",
}


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


def _git(*args: str) -> str | None:
    if shutil.which("git") is None:
        return None
    try:
        proc = subprocess.run(
            ["git", *args], cwd=REPO, capture_output=True, timeout=60, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout.decode("utf-8", errors="replace")


# The imported upstream snapshot ("Import upstream HKUDS/Vibe-Trading @283e300").
# Pinned so the comparisons stay valid after the rebrand is committed.
BASELINE_REF = os.environ.get("T01_BASELINE_REF", "d19d1ac")


@lru_cache(maxsize=1)
def _has_baseline() -> bool:
    return _git("rev-parse", "--verify", f"{BASELINE_REF}^{{commit}}") is not None


def _baseline(path: str) -> str:
    if not _has_baseline():
        pytest.skip("git baseline (T01_BASELINE_REF) unavailable")
    text = _git("show", f"{BASELINE_REF}:{path}")
    if text is None:
        pytest.skip(f"{path} not present in baseline")
    return text


@lru_cache(maxsize=1)
def _repo_text_files() -> tuple[str, ...]:
    """Tracked + untracked-not-ignored text files that exist in the tree."""
    listing = _git("ls-files", "-co", "--exclude-standard")
    if listing is None:
        paths = [
            p.relative_to(REPO).as_posix()
            for p in REPO.rglob("*")
            if p.is_file()
        ]
    else:
        paths = listing.splitlines()
    out: list[str] = []
    for rel in paths:
        if not rel or rel.startswith(_SKIP_PREFIXES):
            continue
        parts = set(rel.split("/"))
        if parts & _SKIP_DIR_PARTS or any(p.endswith(".egg-info") for p in parts):
            continue
        if Path(rel).suffix.lower() in _BINARY_EXT:
            continue
        full = REPO / rel
        if not full.is_file():
            continue  # deleted in working tree but still in the index
        out.append(rel)
    return tuple(sorted(out))


@lru_cache(maxsize=4096)
def _read(rel: str) -> str | None:
    try:
        data = (REPO / rel).read_bytes()
    except OSError:
        return None
    if b"\x00" in data[:4096]:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _hits(pattern: re.Pattern[str], *, files=None) -> list[tuple[str, int, str]]:
    found = []
    for rel in files if files is not None else _repo_text_files():
        text = _read(rel)
        if text is None or not pattern.search(text):
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            if pattern.search(line):
                found.append((rel, lineno, line.strip()[:200]))
    return found


def _fmt(hits) -> str:
    return "\n".join(f"{f}:{n}: {line}" for f, n, line in hits[:40])


def _section(text: str, heading: str) -> str:
    """Return the body of a markdown ``## heading`` section (up to next ##)."""
    m = re.search(rf"^## {re.escape(heading)}\s*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    return m.group(1) if m else ""


# --------------------------------------------------------------------------- #
# 1. Repo-wide brand sweep
# --------------------------------------------------------------------------- #

OLD_BRAND = re.compile(r"Vibe[- ]Trading")


def _allowed_old_brand(rel: str, line: str, text: str) -> bool:
    stripped = line.replace("X-Vibe-Trading-", "")
    if not OLD_BRAND.search(stripped):
        return True  # only the protected HTTP header name
    if rel in {"CHANGELOG.md", "LICENSE"}:
        return True
    if rel == "NOTICE":
        return True  # header line + upstream section, checked exactly below
    if rel == "pyproject.toml" and "HKUDS (upstream Vibe-Trading)" in line:
        return True
    if rel == "README.md" and line in _section(text, "Credits"):
        return True
    return False


def test_old_product_name_only_in_attribution_and_header_names():
    bad = []
    for rel, n, line in _hits(OLD_BRAND):
        if not _allowed_old_brand(rel, line, _read(rel) or ""):
            bad.append((rel, n, line))
    assert not bad, "Upstream brand left in user-visible text:\n" + _fmt(bad)


def test_unofficial_community_build_wording_removed_everywhere():
    hits = _hits(re.compile(r"Unofficial Community Build", re.I))
    assert not hits, _fmt(hits)


def test_docs_site_links_removed_outside_changelog():
    hits = [h for h in _hits(re.compile(r"vibetrading\.wiki")) if h[0] != "CHANGELOG.md"]
    assert not hits, _fmt(hits)


def test_upstream_repo_slug_only_in_attribution():
    allowed = {"CHANGELOG.md", "NOTICE", "LICENSE"}
    bad = []
    for rel, n, line in _hits(re.compile(r"HKUDS/Vibe-Trading", re.I)):
        if rel in allowed:
            continue
        if rel == "README.md" and line in _section(_read(rel) or "", "Credits"):
            continue
        bad.append((rel, n, line))
    assert not bad, _fmt(bad)


def test_old_distribution_name_gone_outside_changelog():
    hits = [h for h in _hits(re.compile(r"vibe-trading-ai")) if h[0] != "CHANGELOG.md"]
    assert not hits, _fmt(hits)


def test_old_mcp_command_only_as_legacy_alias():
    bad = [
        h
        for h in _hits(re.compile(r"vibe-trading-mcp"))
        if h[0] != "CHANGELOG.md"
        and not (h[0] == "pyproject.toml" and h[2].startswith("vibe-trading-mcp ="))
        # T11: the desktop resolver keeps the legacy name as a fallback (ADR 0005).
        and h[0] not in {
            "desktop/electron/src/backend-manager.ts",
            "desktop/electron/scripts/test-backend-resolution.mjs",
        }
    ]
    assert not bad, _fmt(bad)


def test_old_cli_word_not_in_prose_docs():
    """Lower-case ``vibe-trading`` as a CLI word must be gone from md/txt/yml."""
    word = re.compile(r"(?<![\w./~:-])vibe-trading(?![\w-])")
    files = [
        f for f in _repo_text_files()
        if Path(f).suffix.lower() in {".md", ".txt", ".yml", ".yaml"}
        and f != "CHANGELOG.md"
    ]
    hits = _hits(word, files=files)
    assert not hits, _fmt(hits)


# Literals that are internal identifiers (kept on purpose, see handoff T01).
_INTERNAL_CLI_WORD_SITES = {
    "agent/src/providers/openai_codex.py",
    "agent/src/channels/utils.py",
    "agent/src/trading/connectors/shoonya/sdk.py",
    "agent/src/trading/connectors/mt5/orders.py",
}


def test_old_cli_word_in_python_source_only_at_known_internal_sites():
    word = re.compile(r"(?<![\w./~:-])vibe-trading(?![\w-])")
    files = [
        f for f in _repo_text_files()
        if f.endswith(".py") and f.startswith("agent/")
        and "/tests/" not in f and not f.startswith("agent/tests/")
    ]
    bad = [h for h in _hits(word, files=files) if h[0] not in _INTERNAL_CLI_WORD_SITES]
    assert not bad, "CLI help/instructions still say vibe-trading:\n" + _fmt(bad)


def test_bulk_replace_did_not_point_upstream_issue_refs_at_fork():
    """``HKUDS/Vibe-Trading#123`` must not have become a fork issue link."""
    hits = _hits(re.compile(r"buckleson/vibe-trading-crypto#\d+"))
    assert not hits, _fmt(hits)


def test_no_internal_identifier_was_renamed_to_a_crypto_variant():
    pattern = re.compile(
        r"VIBE_CRYPTO_|vibe_crypto_api_auth_key|\.vibe-crypto\b|X-Vibe-Crypto-|"
        r"vibe-crypto-analysis|[\"'`]vibe-crypto:[a-z]|\bvibe_crypto\b(?!\.egg)"
    )
    bad = _hits(pattern)
    assert not bad, _fmt(bad)


@pytest.mark.parametrize("bad_token", ["Vibe Crypto/", "Vibe-Crypto/", "Vibe Trading/", "Vibe-Trading/"])
def test_user_agent_product_tokens_have_no_space_or_old_brand(bad_token):
    files = [f for f in _repo_text_files() if f.endswith(".py") and not f.startswith("agent/tests/")]
    pat = re.compile(r"[\"'][^\"'\n]*" + re.escape(bad_token))
    hits = [h for h in _hits(pat, files=files) if "User-Agent" in h[2] or "_UA" in h[2] or "AGENT" in h[2]]
    assert not hits, _fmt(hits)


def test_runtime_user_agent_constants_are_valid_tokens():
    from src.providers import capabilities

    assert re.fullmatch(r"VibeCrypto/\S+", capabilities._VIBE_USER_AGENT), capabilities._VIBE_USER_AGENT

    from backtest.loaders import sec_edgar_client

    ua = sec_edgar_client._DEFAULT_SEC_UA
    assert ua.startswith("VibeCrypto/1.0 ")
    assert "Vibe-Trading" not in ua and "Vibe Crypto/" not in ua


# --------------------------------------------------------------------------- #
# 2. Deletions and dangling references
# --------------------------------------------------------------------------- #

_LANGS = ("ar", "es", "id", "ja", "ko", "zh")

DELETED = [
    *(f"README_{lang}.md" for lang in _LANGS),
    *(f"assets/features/{lang}" for lang in _LANGS),
    "wiki",
    "zimaos",
    ".github/workflows/wiki.yml",
    ".github/workflows/wiki-deploy.yml",
]


@pytest.mark.parametrize("rel", DELETED)
def test_upstream_only_surface_is_deleted(rel):
    assert not (REPO / rel).exists(), f"{rel} should be deleted (ADR 0001 point 4)"


def test_non_language_feature_assets_are_kept():
    features = REPO / "assets" / "features"
    if not features.exists():
        pytest.skip("no assets/features dir")
    remaining = [p.name for p in features.iterdir()]
    assert remaining, "deleting language folders must not wipe the other feature assets"
    assert not set(remaining) & set(_LANGS)


def test_no_dangling_references_to_deleted_paths():
    pattern = re.compile(
        r"README_(?:ar|es|id|ja|ko|zh)\.md|README_xx|zimaos|wiki-deploy\.yml|"
        r"workflows/wiki\.yml|assets/features/(?:ar|es|id|ja|ko|zh)/|(?<![\w./-])wiki/"
    )
    # CHANGELOG and the news feed are upstream history and stay untouched.
    bad = [h for h in _hits(pattern) if h[0] not in {"CHANGELOG.md", "guides/news.md"}]
    assert not bad, _fmt(bad)


@pytest.mark.parametrize("rel", ["MANIFEST.in", "Dockerfile", ".dockerignore", "pyproject.toml", ".gitignore"])
def test_packaging_manifests_do_not_list_deleted_paths(rel):
    text = _read(rel)
    if text is None:
        pytest.skip(f"{rel} absent")
    for needle in ("wiki", "zimaos", "README_zh", "README_ja", "README_ko", "README_ar", "README_es", "README_id"):
        assert needle not in text, f"{rel} still mentions {needle}"


def test_readme_relative_links_resolve():
    text = _read("README.md") or ""
    targets = re.findall(r"(?:href|src)=\"([^\"#:]+)\"|\]\(([^)#:\s]+)\)", text)
    missing = []
    for a, b in targets:
        target = (a or b).split("?")[0]
        if not target or target.startswith(("http", "mailto", "//")):
            continue
        if not (REPO / target).exists():
            missing.append(target)
    assert not missing, f"README links to missing files: {sorted(set(missing))}"


# --------------------------------------------------------------------------- #
# 3. Python packaging
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def pyproject() -> dict:
    return tomllib.loads((REPO / "pyproject.toml").read_text(encoding="utf-8"))


def test_pyproject_identity(pyproject):
    proj = pyproject["project"]
    assert proj["name"] == "vibe-crypto"
    assert proj["description"] == (
        "Vibe Crypto: AI research, backtesting and paper trading for crypto, stocks and more"
    )
    assert proj["authors"] == [
        {"name": "Vibe Crypto contributors"},
        {"name": "HKUDS (upstream Vibe-Trading)", "email": "hkuds@connect.hku.hk"},
    ]
    assert {"crypto", "paper-trading"} <= set(proj["keywords"])
    assert len(proj["keywords"]) == len(set(proj["keywords"])), "duplicate keywords"


def test_pyproject_version_unchanged(pyproject):
    assert pyproject["project"]["version"] == "0.1.19"
    base = tomllib.loads(_baseline("pyproject.toml"))
    assert pyproject["project"]["version"] == base["project"]["version"]


def test_pyproject_dependencies_untouched_by_rebrand(pyproject):
    base = tomllib.loads(_baseline("pyproject.toml"))
    assert pyproject["project"]["dependencies"] == base["project"]["dependencies"]
    assert pyproject["project"].get("optional-dependencies") == base["project"].get("optional-dependencies")


def test_pyproject_urls_point_at_fork(pyproject):
    urls = pyproject["project"]["urls"]
    assert urls, "project.urls missing"
    for key, url in urls.items():
        assert url.startswith(FORK_URL), f"{key} -> {url}"
        assert "HKUDS" not in url and "vibetrading.wiki" not in url


def test_pyproject_scripts_new_names_and_legacy_aliases(pyproject):
    scripts = pyproject["project"]["scripts"]
    assert scripts["vibe-crypto"] == "cli:main"
    assert scripts["vibe-crypto-mcp"] == "mcp_server:main"
    assert scripts["vibe-trading"] == scripts["vibe-crypto"]
    assert scripts["vibe-trading-mcp"] == scripts["vibe-crypto-mcp"]


def test_pyproject_legacy_alias_comment_present():
    text = (REPO / "pyproject.toml").read_text(encoding="utf-8")
    block = text.split("[project.scripts]", 1)[1].split("\n[", 1)[0]
    lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
    comment = "# legacy aliases, see docs/vibe-crypto/ADR/0001-rebrand.md"
    assert comment in lines
    idx = lines.index(comment)
    assert {ln.split("=")[0].strip() for ln in lines[idx + 1:]} >= {"vibe-trading", "vibe-trading-mcp"}
    assert all(not ln.startswith(("vibe-trading", "vibe-trading-mcp")) for ln in lines[:idx]), (
        "legacy aliases must sit under the legacy comment"
    )


def test_requirements_install_hint_uses_new_distribution():
    text = (AGENT / "requirements.txt").read_text(encoding="utf-8")
    assert 'pip install "vibe-crypto[anthropic]"' in text
    assert "vibe-trading-ai" not in text


def test_installed_distribution_metadata_matches_pyproject():
    from importlib import metadata

    try:
        dist = metadata.distribution("vibe-crypto")
    except metadata.PackageNotFoundError:
        pytest.skip("vibe-crypto not installed in this interpreter")
    assert dist.version == "0.1.19"
    names = {ep.name: ep.value for ep in dist.entry_points if ep.group == "console_scripts"}
    for name, target in {
        "vibe-crypto": "cli:main",
        "vibe-crypto-mcp": "mcp_server:main",
        "vibe-trading": "cli:main",
        "vibe-trading-mcp": "mcp_server:main",
    }.items():
        assert names.get(name) == target, (name, names)


def test_old_distribution_not_left_installed_alongside_new_one():
    """A stale ``vibe-trading-ai`` editable install shadows the new metadata."""
    from importlib import metadata

    try:
        metadata.distribution("vibe-crypto")
    except metadata.PackageNotFoundError:
        pytest.skip("vibe-crypto not installed in this interpreter")
    with pytest.raises(metadata.PackageNotFoundError):
        metadata.distribution("vibe-trading-ai")


def test_stale_old_egg_info_removed():
    assert not (AGENT / "vibe_trading_ai.egg-info").exists()


def _script(name: str) -> str:
    for cand in (VENV_BIN / name, VENV_BIN / f"{name}.exe"):
        if cand.exists():
            return str(cand)
    found = shutil.which(name)
    if not found:
        pytest.skip(f"{name} console script not installed")
    return found


@pytest.mark.parametrize(
    ("cmd", "needle"),
    [
        ("vibe-crypto", "Vibe Crypto CLI"),
        ("vibe-crypto-mcp", "Vibe Crypto MCP Server"),
        ("vibe-trading", "Vibe Crypto CLI"),
        ("vibe-trading-mcp", "Vibe Crypto MCP Server"),
    ],
)
def test_console_scripts_help_exit_zero(cmd, needle):
    env = {**os.environ, "NO_COLOR": "1", "COLUMNS": "200"}
    proc = subprocess.run(
        [_script(cmd), "--help"], capture_output=True, text=True, timeout=120, env=env
    )
    out = proc.stdout + proc.stderr
    assert proc.returncode == 0, out[-2000:]
    assert needle in out
    assert "Vibe-Trading" not in out and "Vibe Trading" not in out


def test_cli_rejects_unknown_option_with_nonzero_exit():
    proc = subprocess.run(
        [_script("vibe-crypto"), "--definitely-not-a-flag"],
        capture_output=True, text=True, timeout=120,
        env={**os.environ, "NO_COLOR": "1"},
    )
    assert proc.returncode != 0
    assert "Vibe-Trading" not in proc.stdout + proc.stderr


# --------------------------------------------------------------------------- #
# 4. Python code surfaces
# --------------------------------------------------------------------------- #


def test_fastmcp_display_name_and_version():
    import mcp_server
    from cli._version import __version__

    assert mcp_server.mcp.name == "Vibe Crypto"
    assert getattr(mcp_server.mcp, "version", __version__) == __version__


def test_mcp_argparse_description_source():
    src = (AGENT / "mcp_server.py").read_text(encoding="utf-8")
    assert 'argparse.ArgumentParser(description="Vibe Crypto MCP Server")' in src
    assert 'FastMCP("Vibe Crypto", version=APP_VERSION)' in src


def _decorated_tool_names(source: str) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for dec in node.decorator_list:
                target = dec.func if isinstance(dec, ast.Call) else dec
                if ast.unparse(target) == "mcp.tool":
                    explicit = None
                    if isinstance(dec, ast.Call):
                        for kw in dec.keywords:
                            if kw.arg == "name" and isinstance(kw.value, ast.Constant):
                                explicit = kw.value.value
                    names.add(explicit or node.name)
    return names


def test_mcp_tool_names_unchanged_from_baseline():
    now = _decorated_tool_names((AGENT / "mcp_server.py").read_text(encoding="utf-8"))
    base = _decorated_tool_names(_baseline("agent/mcp_server.py"))
    assert base, "baseline parse found no tools"
    assert now == base, {"removed": sorted(base - now), "added": sorted(now - base)}


def test_fastapi_title_is_branded():
    tree = ast.parse((AGENT / "api_server.py").read_text(encoding="utf-8"))
    titles = [
        kw.value.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and ast.unparse(node.func) == "FastAPI"
        for kw in node.keywords
        if kw.arg == "title" and isinstance(kw.value, ast.Constant)
    ]
    assert titles == ["Vibe Crypto API"]


@pytest.mark.parametrize("width", [20, 80, 200])
def test_cli_banner_shows_new_wordmark_at_any_width(width):
    from rich.console import Console

    from cli.ui import banner

    console = Console(record=True, width=width, color_system=None, force_terminal=False)
    banner.print_banner(console, model="test-model", skills=1, tools=2, sessions=3, version="9.9.9")
    out = console.export_text()
    flat = " ".join(out.split())  # narrow consoles wrap the meta line
    assert "Vibe Crypto" in out.splitlines()[1] or "Vibe Crypto" in out
    assert "vibe-crypto v9.9.9" in flat
    assert "test-model" in flat
    assert "Vibe-Trading" not in out and "VIBE" not in out


def test_cli_banner_wordmark_is_plain_text():
    from cli.ui import banner

    assert banner._LOGO == ("Vibe Crypto",)


def test_cli_banner_default_version_matches_package():
    from rich.console import Console

    from cli._version import __version__
    from cli.ui import banner

    console = Console(record=True, width=120, color_system=None)
    banner.print_banner(console, model="m", skills=0, tools=0, sessions=0)
    assert f"vibe-crypto v{__version__}" in console.export_text()


def test_cli_sources_have_no_old_brand_or_ascii_art_of_it():
    bad = []
    for path in (AGENT / "cli").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if OLD_BRAND.search(text) or "TRADING" in text and "VIBE_TRADING" not in text:
            bad.append(str(path.relative_to(REPO)))
    assert not bad, bad


def test_setup_prompts_keep_runtime_root_path():
    hits = _hits(re.compile(r"~/\.vibe-crypto"))
    assert not hits, "runtime root must stay ~/.vibe-trading:\n" + _fmt(hits)


def test_runtime_root_default_unchanged(monkeypatch, tmp_path):
    from src.config import paths

    assert paths._HOME_ENV_VAR == "VIBE_TRADING_HOME"
    monkeypatch.delenv("VIBE_TRADING_HOME", raising=False)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    assert paths.get_runtime_root() == tmp_path / ".vibe-trading"
    monkeypatch.setenv("VIBE_TRADING_HOME", str(tmp_path / "custom"))
    assert paths.get_runtime_root() == tmp_path / "custom"
    monkeypatch.setenv("VIBE_TRADING_HOME", "   ")
    assert paths.get_runtime_root() == tmp_path / ".vibe-trading"
    monkeypatch.setenv("VIBE_TRADING_HOME", "//server/share")
    with pytest.raises(ValueError):
        paths.get_runtime_root()


def test_websocket_auth_header_name_unchanged():
    text = (AGENT / "src" / "channels" / "websocket.py").read_text(encoding="utf-8")
    assert 'request.headers.get("X-Vibe-Trading-Auth"' in text


def test_skill_markdown_uses_new_product_name():
    files = [f for f in _repo_text_files() if f.startswith("agent/src/skills/") or f == "agent/SKILL.md"]
    assert files
    hits = _hits(OLD_BRAND, files=files)
    assert not hits, _fmt(hits)
    assert "Vibe Crypto" in (AGENT / "SKILL.md").read_text(encoding="utf-8")


# --------------------------------------------------------------------------- #
# 5. Internal identifiers preserved (compare against the upstream baseline)
# --------------------------------------------------------------------------- #

_ID_SCOPES = ("agent", "frontend/src", "desktop/electron/src", "desktop/electron/scripts",
              "docker-compose.yml", "Dockerfile")


def _baseline_matches(regex: str, scopes=_ID_SCOPES) -> dict[str, set[str]]:
    if not _has_baseline():
        pytest.skip("git baseline unavailable")
    # ``git grep -l <rev>`` prints "<rev>:<path>" for each matching file.
    files = _git("grep", "-lP", "-I", "-e", regex, BASELINE_REF, "--", *scopes) or ""
    result: dict[str, set[str]] = {}
    pat = re.compile(regex)
    for entry in files.splitlines():
        rel = entry.split(":", 1)[1]
        if not (REPO / rel).is_file():
            continue  # file deleted by T01 (wiki-only), not a rename
        content = _git("show", f"{BASELINE_REF}:{rel}") or ""
        result[rel] = set(pat.findall(content))
    return result


@pytest.mark.parametrize(
    "regex",
    [
        r"VIBE_TRADING_[A-Z0-9_]+",
        r"\.vibe-trading\b",
        r"X-Vibe-Trading-[A-Za-z]+",
        r"vibe_trading_[a-z_]+",
        r"vibe:[a-z-]+",
        r"vibe-analysis-v\d+",
    ],
    ids=["env-vars", "runtime-root", "header-names", "snake-identifiers", "dom-events", "storage-prefix"],
)
def test_internal_identifiers_survive_in_every_file(regex):
    missing = []
    pat = re.compile(regex)
    for rel, base_ids in _baseline_matches(regex).items():
        now = set(pat.findall((REPO / rel).read_text(encoding="utf-8", errors="replace")))
        lost = base_ids - now
        if lost:
            missing.append(f"{rel}: {sorted(lost)}")
    assert not missing, "internal identifiers renamed or dropped:\n" + "\n".join(missing[:40])


def test_frontend_storage_keys_unchanged():
    regex = r"(?:local|session)Storage\.(?:get|set|remove)Item\(\s*[\"'`]([^\"'`]+)|[A-Z_]*KEY[A-Z_]*\s*=\s*[\"'`]([^\"'`]+)"
    pat = re.compile(regex)
    lost = []
    for rel, _ in _baseline_matches(regex, scopes=("frontend/src",)).items():
        base = {a or b for a, b in pat.findall(_git("show", f"{BASELINE_REF}:{rel}") or "")}
        now = {a or b for a, b in pat.findall((REPO / rel).read_text(encoding="utf-8"))}
        if base - now:
            lost.append(f"{rel}: {sorted(base - now)}")
    assert not lost, lost


def test_api_auth_storage_key_value_unchanged():
    hits = _hits(re.compile(r"[\"']vibe_trading_api_auth_key[\"']"),
                 files=[f for f in _repo_text_files() if f.startswith("frontend/src/")])
    assert hits, "auth key storage name vanished or was renamed"


# --------------------------------------------------------------------------- #
# 6. Attribution: LICENSE, NOTICE, CHANGELOG, README
# --------------------------------------------------------------------------- #

NOTICE_HEADER = (
    "Vibe Crypto\n"
    "Copyright 2026 Vibe Crypto contributors.\n\n"
    "Vibe Crypto is a fork of Vibe-Trading (https://github.com/HKUDS/Vibe-Trading),\n"
    "copyright HKUDS contributors, used under the MIT License.\n\n"
    "--- Upstream NOTICE follows ---\n\n"
)


def test_notice_header_then_full_upstream_notice():
    text = (REPO / "NOTICE").read_text(encoding="utf-8")
    assert text.startswith(NOTICE_HEADER)
    assert text[len(NOTICE_HEADER):] == _baseline("NOTICE")
    assert text.count("--- Upstream NOTICE follows ---") == 1


def test_license_keeps_upstream_text_plus_one_fork_line():
    now = (REPO / "LICENSE").read_text(encoding="utf-8").splitlines()
    base = _baseline("LICENSE").splitlines()
    original = "Copyright (c) 2026 Vibe-Trading Contributors"
    fork = "Copyright (c) 2026 Vibe Crypto contributors"
    assert original in now and fork in now
    assert now.index(fork) == now.index(original) + 1, "fork line must sit directly below"
    assert [ln for ln in now if ln != fork] == base
    assert now[0] == "MIT License"


def test_changelog_prepends_fork_section_and_keeps_history():
    now = (REPO / "CHANGELOG.md").read_text(encoding="utf-8")
    base = _baseline("CHANGELOG.md")
    prefix = (
        "# Changelog\n\n## Vibe Crypto (unreleased)\n\n"
        "- Forked from HKUDS/Vibe-Trading at 283e300 and rebranded to Vibe Crypto "
        "(see docs/vibe-crypto/ADR/0001-rebrand.md).\n\n## Upstream Vibe-Trading history\n\n"
    )
    assert now.startswith(prefix)
    rest = now[len(prefix):]
    base_body = base[len("# Changelog\n\n"):] if base.startswith("# Changelog\n\n") else base
    assert rest == base_body, "upstream history must be byte-for-byte unchanged"
    assert now.count("\n# Changelog") == 0 and now.count("# Changelog") == 1


def test_readme_head_and_credits():
    text = (REPO / "README.md").read_text(encoding="utf-8")
    assert text.splitlines()[0] == "# Vibe Crypto"
    head = text[:1500]
    assert "Claude" in head and "crypto" in head.lower() and "paper trading" in head
    credits = _section(text, "Credits")
    assert (
        "Vibe Crypto is a fork of [Vibe-Trading](https://github.com/HKUDS/Vibe-Trading) "
        "by HKUDS, licensed under MIT. See LICENSE and NOTICE."
    ) in credits
    headings = re.findall(r"^## (.+)$", text, re.M)
    assert headings[-1] == "Credits", "Credits must be the last section"


def test_readme_has_no_language_switcher():
    text = (REPO / "README.md").read_text(encoding="utf-8")
    assert "README_" not in text
    assert "中文" not in text[:2000]


# --------------------------------------------------------------------------- #
# 7. Frontend metadata
# --------------------------------------------------------------------------- #


def test_frontend_index_html_title_and_description():
    html = (FRONTEND / "index.html").read_text(encoding="utf-8-sig")
    assert re.findall(r"<title>(.*?)</title>", html) == ["Vibe Crypto"]
    descs = re.findall(r'<meta name="description" content="([^"]*)"\s*/?>', html)
    assert descs == [
        "Vibe Crypto: research, backtest and paper trade crypto, stocks and more with Claude."
    ]


def test_frontend_package_and_lock_names():
    pkg = json.loads((FRONTEND / "package.json").read_text(encoding="utf-8"))
    assert pkg["name"] == "vibe-crypto-frontend"
    lock = json.loads((FRONTEND / "package-lock.json").read_text(encoding="utf-8"))
    assert lock["name"] == "vibe-crypto-frontend"
    assert lock["packages"][""]["name"] == "vibe-crypto-frontend"
    base = json.loads(_baseline("frontend/package.json"))
    assert pkg["version"] == base["version"]
    # T11 added the embedded terminal packages.
    added = {"@xterm/xterm", "@xterm/addon-fit"}
    assert {k: v for k, v in pkg["dependencies"].items() if k not in added} == base["dependencies"]


@pytest.mark.parametrize("svg", ["logo.svg", "favicon.svg"])
def test_frontend_svg_titles_not_old_brand(svg):
    path = FRONTEND / "public" / svg
    if not path.exists():
        pytest.skip(f"{svg} absent")
    text = path.read_text(encoding="utf-8")
    assert not OLD_BRAND.search(text)
    for title in re.findall(r"<title>(.*?)</title>", text, re.S):
        assert "Vibe Crypto" in title


def _flatten(obj, prefix=""):
    out = {}
    for key, value in obj.items():
        full = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            out.update(_flatten(value, full))
        else:
            out[full] = value
    return out


LOCALE_DIR = FRONTEND / "src" / "i18n" / "locales"
LOCALES = sorted(p.name for p in LOCALE_DIR.glob("*.json") if p.name != "tsconfig.json")


def test_eleven_frontend_locales_present():
    assert len(LOCALES) == 11, LOCALES


@pytest.mark.parametrize("name", LOCALES)
def test_locale_keys_unchanged_and_values_rebranded(name):
    now = _flatten(json.loads((LOCALE_DIR / name).read_text(encoding="utf-8")))
    base = _flatten(json.loads(_baseline(f"frontend/src/i18n/locales/{name}")))
    assert set(now) == set(base), "rebrand must never touch keys"
    for key, value in now.items():
        if not isinstance(value, str):
            continue
        assert not OLD_BRAND.search(value.replace("X-Vibe-Trading-Auth", "")), (key, value)
        assert "vibetrading.wiki" not in value, key
        if isinstance(base[key], str) and OLD_BRAND.search(base[key].replace("X-Vibe-Trading-Auth", "")):
            assert "Vibe Crypto" in value, f"{key}: brand dropped instead of renamed"
    assert "Vibe Crypto" in now["layout.sidebar"]


def test_locale_key_sets_identical_across_languages():
    sets = {n: set(_flatten(json.loads((LOCALE_DIR / n).read_text(encoding="utf-8")))) for n in LOCALES}
    en = sets["en.json"]
    diffs = {n: len(s ^ en) for n, s in sets.items() if s != en}
    assert not diffs, diffs


def test_frontend_source_has_no_docs_site_or_old_brand():
    files = [f for f in _repo_text_files() if f.startswith("frontend/src/") and "__tests__" not in f]
    hits = [h for h in _hits(re.compile(r"vibetrading\.wiki|Vibe-Trading(?!-Auth)|Vibe Trading"), files=files)
            if "X-Vibe-Trading-Auth" not in h[2]]
    assert not hits, _fmt(hits)


def test_frontend_i18n_comment_does_not_reference_deleted_readmes():
    text = (FRONTEND / "src" / "i18n" / "index.ts").read_text(encoding="utf-8")
    assert "README_" not in text, "step 2: fix the comment that mentions README_xx.md"


def test_layout_brand_strings():
    text = (FRONTEND / "src" / "components" / "layout" / "Layout.tsx").read_text(encoding="utf-8")
    assert "defaultValue: 'Vibe Crypto sidebar'" in text
    assert 'aria-label="Vibe Crypto"' in text
    assert ">Vibe Crypto</span>" in text


# --------------------------------------------------------------------------- #
# 8. Electron desktop
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def electron_pkg() -> dict:
    return json.loads((ELECTRON / "package.json").read_text(encoding="utf-8"))


def test_electron_package_identity(electron_pkg):
    assert electron_pkg["name"] == "vibe-crypto-desktop"
    assert electron_pkg["description"] == "Vibe Crypto desktop app"
    assert electron_pkg["author"] == "Vibe Crypto contributors"
    build = electron_pkg["build"]
    assert build["productName"] == "Vibe Crypto"
    assert build["appId"] == "io.github.buckleson.vibecrypto"
    assert re.fullmatch(r"[A-Za-z0-9.-]+", build["appId"]), "appId must be reverse-DNS"
    assert build["artifactName"] == "Vibe-Crypto-${version}-${os}-${arch}.${ext}"
    targets = sorted(r["to"] for r in build["extraResources"] if r["to"].startswith("licenses/"))
    assert targets == ["licenses/Vibe-Crypto-LICENSE.txt", "licenses/Vibe-Crypto-NOTICE.txt"]


def test_electron_package_unchanged_fields(electron_pkg):
    base = json.loads(_baseline("desktop/electron/package.json"))
    # T11 added cross-platform scripts and made `start` independent of the Windows prepare step.
    base_scripts = {k: v for k, v in base["scripts"].items() if k != "start"}
    assert {k: electron_pkg["scripts"].get(k) for k in base_scripts} == base_scripts
    assert electron_pkg["version"] == base["version"]
    assert electron_pkg["build"]["win"]["icon"] == base["build"]["win"]["icon"]
    assert {k: electron_pkg["devDependencies"].get(k) for k in base["devDependencies"]} == base["devDependencies"]
    lock = json.loads((ELECTRON / "package-lock.json").read_text(encoding="utf-8"))
    assert lock["name"] in {base["name"], electron_pkg["name"]}


def test_electron_artifact_name_matches_installer_filters(electron_pkg):
    art = (electron_pkg["build"]["artifactName"]
           .replace("${version}", electron_pkg["version"])
           .replace("${os}", "win").replace("${arch}", "x64").replace("${ext}", "exe"))
    for script in ("build-review-installer.mjs", "build-signed-installer.mjs"):
        src = (ELECTRON / "scripts" / script).read_text(encoding="utf-8")
        m = re.search(r"/(\^Vibe-[^/]+)/u", src)
        assert m, f"{script}: installer regex not found"
        js_re = m.group(1)
        assert re.fullmatch(js_re, art), (script, js_re, art)
        assert not re.fullmatch(js_re, art.replace("Vibe-Crypto", "Vibe-Trading"))
    wf = (REPO / ".github" / "workflows" / "desktop.yml").read_text(encoding="utf-8")
    filt = re.search(r"-Filter '([^']+)'", wf)
    assert filt
    import fnmatch

    assert fnmatch.fnmatch(art, filt.group(1))


def test_build_backend_license_names_match_extra_resources(electron_pkg):
    ps1 = (ELECTRON / "scripts" / "build-backend.ps1").read_text(encoding="utf-8")
    for target in ("Vibe-Crypto-LICENSE.txt", "Vibe-Crypto-NOTICE.txt"):
        assert target in ps1
    assert "Vibe-Trading-LICENSE" not in ps1 and "vibe-trading-ai" not in ps1


def test_electron_main_and_backend_manager_sources():
    main = (ELECTRON / "src" / "main.ts").read_text(encoding="utf-8")
    assert 'const productName = "Vibe Crypto";' in main
    assert 'partition: "persist:vibe-crypto"' in main
    assert "persist:vibe-trading" not in main
    bm = (ELECTRON / "src" / "backend-manager.ts").read_text(encoding="utf-8")
    assert 'const sourceProjectName = "vibe-crypto";' in bm
    assert "vibe-trading.exe" in bm, "exe lookup must stay until T11"
    loading = (ELECTRON / "src" / "loading.html").read_text(encoding="utf-8")
    assert "<title>Vibe Crypto</title>" in loading


def test_electron_source_project_name_matches_pyproject(pyproject):
    bm = (ELECTRON / "src" / "backend-manager.ts").read_text(encoding="utf-8")
    m = re.search(r'const sourceProjectName = "([^"]+)"', bm)
    assert m and m.group(1) == pyproject["project"]["name"]


def test_electron_docs_and_sources_have_no_old_brand():
    files = [f for f in _repo_text_files() if f.startswith("desktop/")]
    hits = _hits(OLD_BRAND, files=files)
    assert not hits, _fmt(hits)


# --------------------------------------------------------------------------- #
# 9. Root and infra
# --------------------------------------------------------------------------- #


def test_docker_compose_service_renamed_env_names_kept():
    import yaml

    data = yaml.safe_load((REPO / "docker-compose.yml").read_text(encoding="utf-8"))
    assert "vibe-crypto" in data["services"]
    assert "vibe-trading" not in data["services"]
    svc = data["services"]["vibe-crypto"]
    env = svc.get("environment", [])
    assert any(str(e).startswith("VIBE_TRADING_") for e in env)
    for key in ("container_name", "image"):
        if key in svc:
            assert "vibe-crypto" in svc[key] or "vibe-trading-crypto" in svc[key]
    for other in data["services"].values():
        for e in other.get("environment", []) or []:
            if "VITE_API_URL" in str(e):
                assert "vibe-crypto" in str(e)


def test_dockerfile_labels_and_cmd():
    text = (REPO / "Dockerfile").read_text(encoding="utf-8")
    assert 'org.opencontainers.image.title="Vibe Crypto"' in text
    assert f'org.opencontainers.image.source="{FORK_URL}"' in text
    assert 'CMD ["vibe-crypto", "serve"' in text
    assert ".vibe-trading" in text, "runtime root path inside the image must stay"


def test_devcontainer_name():
    path = REPO / ".devcontainer" / "devcontainer.json"
    if not path.exists():
        pytest.skip("no devcontainer")
    text = path.read_text(encoding="utf-8")
    assert "Vibe Crypto" in text and not OLD_BRAND.search(text)


def test_workflows_reference_no_upstream_images():
    for wf in (REPO / ".github" / "workflows").glob("*.y*ml"):
        text = wf.read_text(encoding="utf-8")
        assert "ghcr.io/hkuds" not in text.lower(), wf.name
        for image in re.findall(r"ghcr\.io/[\w./-]+", text):
            assert image.startswith("ghcr.io/buckleson/vibe-trading-crypto"), (wf.name, image)


def test_security_and_conduct_contacts_point_at_fork():
    sec = (REPO / "SECURITY.md").read_text(encoding="utf-8")
    assert f"{FORK_URL}/security/advisories" in sec
    coc = (REPO / "CODE_OF_CONDUCT.md").read_text(encoding="utf-8")
    assert f"{FORK_URL}/issues" in coc
    assert "HKUDS" not in sec and "HKUDS" not in coc


def test_issue_template_links_point_at_fork():
    for path in (REPO / ".github" / "ISSUE_TEMPLATE").glob("*"):
        text = path.read_text(encoding="utf-8")
        for url in re.findall(r"https?://[^\s\"')]+", text):
            assert "HKUDS" not in url and "vibetrading.wiki" not in url, (path.name, url)


def test_version_consistent_across_surfaces():
    from cli._version import __version__

    assert __version__ == "0.1.19"
    pkg = json.loads((FRONTEND / "package.json").read_text(encoding="utf-8"))
    base_pkg = json.loads(_baseline("frontend/package.json"))
    assert pkg["version"] == base_pkg["version"]


if __name__ == "__main__":  # pragma: no cover
    sys.exit(pytest.main([__file__, "-q"]))
