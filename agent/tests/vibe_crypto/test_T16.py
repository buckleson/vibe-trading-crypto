"""T16: Claude Code plugin marketplace structure (offline)."""

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
PLUGIN = ROOT / "plugins" / "vibe-crypto"
GIT_SRC = "git+https://github.com/buckleson/vibe-trading-crypto"
COMMANDS = ["connect-broker", "portfolio", "paper-run", "status"]


def _json(p):
    return json.loads(p.read_text(encoding="utf-8"))


def _frontmatter(p):
    m = re.match(r"---\n(.*?)\n---\n", p.read_text(encoding="utf-8"), re.S)
    assert m, f"no frontmatter in {p}"
    return dict(line.split(":", 1) for line in m.group(1).splitlines() if ":" in line)


def test_marketplace_and_plugin_manifests():
    mk = _json(ROOT / ".claude-plugin" / "marketplace.json")
    assert mk["name"] == "vibe-crypto"
    entry = mk["plugins"][0]
    src = ROOT / entry["source"]
    assert src.is_dir()
    pj = _json(src / ".claude-plugin" / "plugin.json")
    assert pj["name"] == entry["name"] == "vibe-crypto"
    assert pj["version"] == entry["version"] == mk["metadata"]["version"]


def test_mcp_json():
    srv = _json(PLUGIN / ".mcp.json")["mcpServers"]["vibe-crypto"]
    assert srv["command"] == "uvx"
    args = srv["args"]
    assert args[args.index("--from") + 1] == GIT_SRC
    assert args[-1] == "vibe-crypto-mcp"


@pytest.mark.parametrize("name", COMMANDS)
def test_commands(name):
    p = PLUGIN / "commands" / f"{name}.md"
    assert p.is_file()
    assert _frontmatter(p).get("description", "").strip()


def test_skill():
    fm = _frontmatter(PLUGIN / "skills" / "safe-trading" / "SKILL.md")
    assert fm["name"].strip() == "safe-trading"
    assert fm.get("description", "").strip()


def test_plugin_files_clean():
    files = [p for p in PLUGIN.rglob("*") if p.is_file() and p.suffix != ".png"]
    files.append(ROOT / ".claude-plugin" / "marketplace.json")
    emoji = re.compile("[\U0001f000-\U0001faff☀-➿]")
    for p in files:
        t = p.read_text(encoding="utf-8")
        assert "\u2014" not in t, p
        assert not emoji.search(t), p
        for bad in ("sk-", "API_KEY=", "SECRET="):
            assert bad not in t, (p, bad)


@pytest.mark.skipif(not shutil.which("claude"), reason="claude CLI not found")
@pytest.mark.parametrize("target", [ROOT, PLUGIN])
def test_claude_validate(target):
    r = subprocess.run(
        ["claude", "plugin", "validate", str(target)],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert r.returncode == 0, r.stdout + r.stderr


# --------------------------------------------------------------------------- #
# Edge and cross-check cases (T16 test engineer). Offline unless
# VIBE_CRYPTO_NETWORK_TESTS=1 is set; see docs/vibe-crypto/tests/T16.md.
# --------------------------------------------------------------------------- #
import asyncio  # noqa: E402
import os  # noqa: E402
import sys  # noqa: E402
import tomllib  # noqa: E402

import yaml  # noqa: E402

AGENT = ROOT / "agent"
if str(AGENT) not in sys.path:
    sys.path.insert(0, str(AGENT))

CANONICAL = (
    "uvx --python 3.12 --with keyring --from git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto-mcp"
)
ORDER_TOOLS = {"trading_place_order", "trading_cancel_order"}
EXPECTED_FILES = {
    ".claude-plugin/plugin.json",
    ".mcp.json",
    "README.md",
    "commands/connect-broker.md",
    "commands/paper-run.md",
    "commands/portfolio.md",
    "commands/status.md",
    "skills/safe-trading/SKILL.md",
}
BINARY_FILES = {".claude-plugin/icon.png"}  # plugin directory listing icon (512x512 PNG)
NETWORK = os.environ.get("VIBE_CRYPTO_NETWORK_TESTS") == "1"
CLAUDE = shutil.which("claude") or ("/opt/node22/bin/claude" if Path("/opt/node22/bin/claude").exists() else None)


def _yaml_frontmatter(p):
    raw = p.read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf"), f"BOM in {p}"
    assert b"\r\n" not in raw, f"CRLF in {p}"
    text = raw.decode("utf-8")
    m = re.match(r"---\n(.*?)\n---\n(.*)", text, re.S)
    assert m, f"no frontmatter in {p}"
    fm = yaml.safe_load(m.group(1))
    assert isinstance(fm, dict), p
    return fm, m.group(2)


def _plugin_text_files():
    return sorted(p for p in PLUGIN.rglob("*") if p.is_file())


def _expand(arg, env):
    """Shell-style ${VAR:-default} / ${VAR} expansion, as Claude Code applies to .mcp.json."""

    def rep(m):
        val = env.get(m.group(1))
        if m.group(2) is not None:
            return val if val else m.group(2)
        return val or ""

    return re.sub(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}", rep, arg)


def _server():
    return _json(PLUGIN / ".mcp.json")["mcpServers"]["vibe-crypto"]


# ---- marketplace / manifest edge cases ------------------------------------ #


def test_marketplace_plugin_names_unique_and_kebab_case():
    mk = _json(ROOT / ".claude-plugin" / "marketplace.json")
    names = [p["name"] for p in mk["plugins"]]
    assert len(names) == len(set(names)) == 1
    for n in [mk["name"], *names]:
        assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", n), n
    assert mk["owner"]["name"].strip()


def test_marketplace_source_is_relative_and_stays_inside_repo():
    mk = _json(ROOT / ".claude-plugin" / "marketplace.json")
    for entry in mk["plugins"]:
        src = entry["source"]
        assert isinstance(src, str) and src.startswith("./"), src
        assert ".." not in Path(src).parts, src
        resolved = (ROOT / src).resolve()
        assert resolved.is_relative_to(ROOT.resolve())
        assert resolved == PLUGIN.resolve()


def test_versions_are_semver_and_match_desktop_release():
    mk = _json(ROOT / ".claude-plugin" / "marketplace.json")
    pj = _json(PLUGIN / ".claude-plugin" / "plugin.json")
    desktop = _json(ROOT / "desktop" / "electron" / "package.json")["version"]
    for v in (mk["metadata"]["version"], mk["plugins"][0]["version"], pj["version"]):
        assert re.fullmatch(r"\d+\.\d+\.\d+", v), v
        assert v == desktop, (v, desktop)


def test_plugin_and_marketplace_descriptions_agree():
    mk = _json(ROOT / ".claude-plugin" / "marketplace.json")
    pj = _json(PLUGIN / ".claude-plugin" / "plugin.json")
    assert pj["description"] == mk["plugins"][0]["description"]
    assert pj["license"] == mk["plugins"][0]["license"] == "MIT"
    assert (ROOT / "LICENSE").is_file()
    for url in (pj["homepage"], pj["repository"], mk["plugins"][0]["repository"]):
        assert url.startswith("https://github.com/buckleson/vibe-trading-crypto"), url


def test_plugin_dir_has_exactly_the_expected_files():
    got = {p.relative_to(PLUGIN).as_posix() for p in _plugin_text_files()}
    assert got == EXPECTED_FILES | BINARY_FILES, got ^ (EXPECTED_FILES | BINARY_FILES)


def test_plugin_files_are_not_gitignored():
    if not (ROOT / ".git").exists() or not shutil.which("git"):
        pytest.skip("not a git checkout")
    paths = [".claude-plugin/marketplace.json"] + [f"plugins/vibe-crypto/{f}" for f in sorted(EXPECTED_FILES | BINARY_FILES)]
    r = subprocess.run(["git", "check-ignore", *paths], cwd=ROOT, capture_output=True, text=True, timeout=30)
    assert r.returncode == 1 and not r.stdout.strip(), r.stdout


# ---- .mcp.json ------------------------------------------------------------ #


def test_mcp_json_has_exact_canonical_args_and_no_env_or_secrets():
    srv = _server()
    assert set(srv) == {"command", "args"}, "no env block: orders flag must come from the user's shell"
    assert srv["args"] == [
        "--python",
        "3.12",
        "--with",
        "${VIBE_CRYPTO_WITH:-keyring}",
        "--from",
        GIT_SRC,
        "vibe-crypto-mcp",
    ]
    blob = json.dumps(srv)
    assert "VIBE_CRYPTO_MCP_ENABLE_ORDERS" not in blob
    assert "VIBE_CRYPTO_MCP_TOKEN" not in blob
    assert "--refresh" not in srv["args"], "refreshing on every start would slow each launch"
    assert "@" not in GIT_SRC.split("github.com/")[1], "must track main, not a pinned ref"


@pytest.mark.parametrize(
    "env,expected_with",
    [
        ({}, "keyring"),
        ({"VIBE_CRYPTO_WITH": ""}, "keyring"),
        ({"VIBE_CRYPTO_WITH": "keyring,alpaca-py"}, "keyring,alpaca-py"),
        ({"VIBE_CRYPTO_WITH": "keyring,ccxt,python-okx"}, "keyring,ccxt,python-okx"),
    ],
)
def test_mcp_args_expand_to_canonical_command(env, expected_with):
    srv = _server()
    argv = [srv["command"], *(_expand(a, env) for a in srv["args"])]
    assert "$" not in " ".join(argv)
    assert argv[argv.index("--with") + 1] == expected_with
    if not env.get("VIBE_CRYPTO_WITH"):
        assert " ".join(argv) == CANONICAL


# ---- commands and skill --------------------------------------------------- #


@pytest.mark.parametrize("name", COMMANDS)
def test_command_frontmatter_is_valid_yaml_without_allowed_tools(name):
    fm, body = _yaml_frontmatter(PLUGIN / "commands" / f"{name}.md")
    assert isinstance(fm.get("description"), str) and len(fm["description"]) > 10
    assert "allowed-tools" not in fm, "normal permission prompts must apply"
    assert "model" not in fm
    assert body.strip()
    if name in ("connect-broker", "paper-run"):
        assert "argument-hint" in fm
        assert "$ARGUMENTS" in body


def test_skill_frontmatter_valid_and_triggers_on_order_tools():
    fm, body = _yaml_frontmatter(PLUGIN / "skills" / "safe-trading" / "SKILL.md")
    assert fm["name"] == "safe-trading"
    desc = fm["description"]
    for needle in ("trading_place_order", "trading_cancel_order", "paper_run_", "connect a broker", "live"):
        assert needle in desc, needle
    assert "allowed-tools" not in fm


def test_skill_contains_all_safety_rules():
    body = (PLUGIN / "skills" / "safe-trading" / "SKILL.md").read_text(encoding="utf-8")
    low = body.lower()
    for needle in (
        "paper first",
        "before every `trading_place_order`",
        "profile id",
        "paper or live",
        "symbol",
        "side",
        "quantity or notional",
        "order type",
        "limit price",
        "time in force",
        "explicit",
        "current message",
        "never loop, batch or auto-retry",
        "`trading_orders`",
        "mandate",
        "kill switch",
        "never look for a workaround",
        "never request or echo",
        "/vibe-crypto:connect-broker",
        "vibe_crypto_mcp_enable_orders=1",
        "not financial advice",
    ):
        assert needle in low, needle


def test_connect_broker_never_collects_secrets_in_chat():
    body = (PLUGIN / "commands" / "connect-broker.md").read_text(encoding="utf-8")
    assert "NEVER ask the user to paste" in body
    assert "keychain" in body.lower()
    assert "hidden terminal prompt" in body
    expected = (
        "uvx --python 3.12 --with keyring,<dependency> --from "
        "git+https://github.com/buckleson/vibe-trading-crypto vibe-crypto connector setup "
        "<profile-id> --connection-id <short-id>"
    )
    assert expected in body
    assert "VIBE_CRYPTO_WITH=keyring,<dependency>" in body
    # Every "paste"/"send" mention must be negated (no positive request for secrets).
    for line in body.splitlines():
        low = line.lower()
        if re.search(r"\b(paste|type|send|share)\b.*\b(key|secret|password|totp)", low):
            assert "never" in low, line


@pytest.mark.parametrize("p", sorted(EXPECTED_FILES))
def test_no_file_positively_asks_for_secrets(p):
    text = (PLUGIN / p).read_text(encoding="utf-8")
    for line in text.splitlines():
        low = line.lower()
        if re.search(r"\b(paste|enter|give me|send me|provide)\b.*\b(api key|secret|password|totp|private key)", low):
            assert re.search(r"\b(never|not|don't|do not)\b", low), (p, line)


def test_portfolio_and_status_are_read_only():
    for name in ("portfolio", "status", "paper-run"):
        body = (PLUGIN / "commands" / f"{name}.md").read_text(encoding="utf-8")
        assert "Call `trading_place_order`" not in body
        assert "call `trading_cancel_order`" not in body.lower()
    port = (PLUGIN / "commands" / "portfolio.md").read_text(encoding="utf-8")
    assert "Never place or cancel orders" in port
    assert "trading_place_order" not in port and "trading_cancel_order" not in port
    paper = (PLUGIN / "commands" / "paper-run.md").read_text(encoding="utf-8")
    assert "no real orders" in paper
    assert "10000" in paper


def test_status_explains_orders_flag_and_update():
    body = (PLUGIN / "commands" / "status.md").read_text(encoding="utf-8")
    assert "VIBE_CRYPTO_MCP_ENABLE_ORDERS=1" in body
    assert "uvx --refresh" in body and GIT_SRC in body
    assert "restart" in body.lower()


def test_readme_has_install_prereqs_warmup_and_update():
    readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
    for needle in (
        "/plugin marketplace add buckleson/vibe-trading-crypto",
        "/plugin install vibe-crypto@vibe-crypto",
        "https://astral.sh/uv/install.sh",
        "https://astral.sh/uv/install.ps1",
        CANONICAL + " --help",
        "185 packages",
        "VIBE_CRYPTO_WITH",
        "VIBE_CRYPTO_MCP_ENABLE_ORDERS=1",
        "/plugin marketplace update vibe-crypto",
        "uvx --refresh",
        "../../guides/share-with-friends.md",
        "not financial advice",
    ):
        assert needle in readme, needle
    for cmd in COMMANDS:
        assert f"/vibe-crypto:{cmd}" in readme, cmd


def test_readme_relative_links_point_inside_repo():
    readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
    links = re.findall(r"\]\(([^)]+)\)", readme)
    assert links
    missing = []
    for link in links:
        if link.startswith("http"):
            continue
        target = (PLUGIN / link).resolve()
        assert target.is_relative_to(ROOT.resolve()), link
        if not target.exists():
            missing.append(link)
    if missing == ["../../guides/share-with-friends.md"]:
        pytest.skip("guides/share-with-friends.md not written yet (T18)")
    assert not missing, missing


# ---- cross-checks against the real server, CLI and packaging -------------- #


@pytest.fixture(scope="module")
def tool_names():
    import mcp_server
    from fastmcp import Client

    async def _list():
        async with Client(mcp_server.mcp) as c:
            return await c.list_tools()

    return {t.name for t in asyncio.run(_list())}


def test_every_tool_named_in_plugin_exists(tool_names):
    non_tools = {"dependency", "paper_run_*", "safe-trading"}
    referenced = set()
    for p in _plugin_text_files():
        if p.suffix != ".md":
            continue
        for tok in re.findall(r"`([a-z][a-z0-9_*]*)`", p.read_text(encoding="utf-8")):
            if "_" in tok or tok == "backtest":
                referenced.add(tok)
    referenced -= non_tools
    assert referenced >= {"trading_connections", "trading_check", "paper_run_start", "paper_run_list"}
    missing = referenced - tool_names - ORDER_TOOLS
    assert not missing, missing


def test_default_tool_count_matches_plugin_description(tool_names):
    assert not tool_names & ORDER_TOOLS, "order tools must be off by default"
    pj = _json(PLUGIN / ".claude-plugin" / "plugin.json")
    n = int(re.search(r"(\d+) tools", pj["description"]).group(1))
    assert len(tool_names) == n


def test_tool_params_used_by_commands_exist():
    import mcp_server
    from fastmcp import Client

    async def _list():
        async with Client(mcp_server.mcp) as c:
            return {t.name: t.inputSchema.get("properties", {}) for t in await c.list_tools()}

    props = asyncio.run(_list())
    assert "connection_id" in props["trading_check"]
    assert "connection" in props["trading_select_connection"]
    assert {"run_id", "initial_cash"} <= set(props["paper_run_start"])
    for t in ("trading_account", "trading_positions", "trading_orders"):
        assert "connection" in props[t] or "connection_id" in props[t]


def test_broker_count_and_dependencies_fit_uv_with():
    from src.trading.onboarding import onboarding_dict
    from src.trading.profiles import list_profiles

    profiles = list_profiles()
    builtin = {p.connector for p in profiles if p.transport != "remote_mcp"}
    pj = _json(PLUGIN / ".claude-plugin" / "plugin.json")
    n = int(re.search(r"(\d+) broker connectors", pj["description"]).group(1))
    assert len({p.connector for p in profiles}) >= n
    assert len(builtin) >= 1
    for p in profiles:
        dep = onboarding_dict(p)["dependency"]
        if dep is None:
            continue
        # Must be usable as `--with keyring,<dep>`: a bare PEP 508 name, no comma or spaces.
        assert re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", dep), (p.id, dep)


def test_connector_setup_cli_accepts_documented_form():
    from cli._legacy import _build_parser
    from src.trading.profiles import list_profiles

    parser = _build_parser()
    pid = list_profiles()[0].id
    args = parser.parse_args(["connector", "setup", pid, "--connection-id", "my-conn"])
    assert args.connector_command == "setup"
    assert args.profile == pid and args.connection_id == "my-conn"
    with pytest.raises(SystemExit):
        parser.parse_args(["connector", "setup"])  # profile is required


def test_pyproject_entry_points_resolve_and_python_312_allowed():
    py = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    scripts = py["project"]["scripts"]
    assert scripts["vibe-crypto-mcp"] == "mcp_server:main"
    assert scripts["vibe-crypto"] == "cli:main"
    import cli
    import mcp_server

    assert callable(mcp_server.main) and callable(cli.main)
    req = py["project"]["requires-python"]
    m = re.fullmatch(r">=\s*3\.(\d+)", req.strip())
    assert m and int(m.group(1)) <= 12, req
    assert "mcp_server" in py["tool"]["setuptools"]["py-modules"]


def test_every_tracked_skill_file_is_package_data():
    py = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    pkg = AGENT / "src"
    covered = set()
    for pat in py["tool"]["setuptools"]["package-data"]["src"]:
        covered |= {p.resolve() for p in pkg.glob(pat) if p.is_file()}
    skills = [p for p in (pkg / "skills").rglob("*") if p.is_file() and "__pycache__" not in p.parts]
    assert len([p for p in skills if p.name == "SKILL.md"]) >= 89
    missing = [str(p.relative_to(pkg)) for p in skills if p.resolve() not in covered]
    assert not missing, missing[:10]


# ---- claude CLI: validate (incl. negative controls) and isolated install --- #


@pytest.mark.skipif(not CLAUDE, reason="claude CLI not found")
@pytest.mark.parametrize("target", [ROOT, PLUGIN])
def test_claude_validate_has_no_errors(target):
    r = subprocess.run([CLAUDE, "plugin", "validate", str(target)], capture_output=True, text=True, timeout=120)
    out = r.stdout + r.stderr
    assert r.returncode == 0, out
    assert "Validation passed" in out
    assert "×" not in out  # no error markers


@pytest.mark.skipif(not CLAUDE, reason="claude CLI not found")
def test_claude_validate_rejects_broken_copies(tmp_path):
    # Negative control: prove validate is not a no-op on our layout.
    bad_plugin = tmp_path / "p"
    shutil.copytree(PLUGIN, bad_plugin)
    (bad_plugin / ".claude-plugin" / "plugin.json").write_text("{bad", encoding="utf-8")
    r = subprocess.run([CLAUDE, "plugin", "validate", str(bad_plugin)], capture_output=True, text=True, timeout=120)
    assert r.returncode != 0

    bad_mk = tmp_path / "m"
    (bad_mk / ".claude-plugin").mkdir(parents=True)
    mk = _json(ROOT / ".claude-plugin" / "marketplace.json")
    mk["plugins"] = mk["plugins"] * 2  # duplicate plugin name
    (bad_mk / ".claude-plugin" / "marketplace.json").write_text(json.dumps(mk), encoding="utf-8")
    r = subprocess.run([CLAUDE, "plugin", "validate", str(bad_mk)], capture_output=True, text=True, timeout=120)
    assert r.returncode != 0


@pytest.mark.skipif(not CLAUDE, reason="claude CLI not found")
def test_claude_isolated_marketplace_add_and_install(tmp_path):
    env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE")}
    env["HOME"] = str(tmp_path)
    env.pop("XDG_CONFIG_HOME", None)

    def run(*a):
        return subprocess.run(
            [CLAUDE, "plugin", *a], capture_output=True, text=True, timeout=120, env=env, cwd=tmp_path
        )

    r = run("marketplace", "add", str(ROOT))
    assert r.returncode == 0, r.stdout + r.stderr
    r = run("install", "vibe-crypto@vibe-crypto")
    assert r.returncode == 0, r.stdout + r.stderr
    r = run("list")
    assert r.returncode == 0 and "vibe-crypto@vibe-crypto" in r.stdout, r.stdout
    assert "0.4.0" in r.stdout
    r = run("install", "does-not-exist@vibe-crypto")
    assert r.returncode != 0


# ---- network (opt-in): real uvx from GitHub main --------------------------- #

network = pytest.mark.skipif(not NETWORK, reason="set VIBE_CRYPTO_NETWORK_TESTS=1 (needs GitHub + PyPI)")


@pytest.mark.integration
@network
@pytest.mark.parametrize(
    "argv",
    [
        ["uvx", "--python", "3.12", "--from", GIT_SRC, "vibe-crypto-mcp", "--help"],
        CANONICAL.split() + ["--help"],
        CANONICAL.split()[:-1] + ["vibe-crypto", "connector", "setup", "--help"],
    ],
)
def test_uvx_from_github_help(argv, tmp_path):
    r = subprocess.run(argv, capture_output=True, text=True, timeout=600, cwd=tmp_path)
    assert r.returncode == 0, r.stderr[-2000:]


@pytest.mark.integration
@network
def test_uvx_stdio_lists_tools_outside_repo(tmp_path):
    from fastmcp import Client

    env = dict(os.environ, HOME=str(tmp_path), VIBE_TRADING_HOME=str(tmp_path / "data"))
    argv = CANONICAL.split()

    async def probe():
        cfg = {"mcpServers": {"v": {"command": argv[0], "args": argv[1:], "env": env, "cwd": str(tmp_path)}}}
        async with Client(cfg, timeout=600) as c:
            tools = await c.list_tools()
            r = await c.call_tool("paper_run_list", {})
            s = await c.call_tool("list_skills", {})
            return len(tools), json.loads(r.content[0].text), json.loads(s.content[0].text)

    n, runs, skills = asyncio.run(probe())
    assert n == 87
    assert runs.get("status") == "ok"
    assert len(skills) >= 89


def test_plugin_icon_is_square_png_in_validator_range():
    raw = (PLUGIN / ".claude-plugin" / "icon.png").read_bytes()
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"
    w, h = int.from_bytes(raw[16:20], "big"), int.from_bytes(raw[20:24], "big")
    assert w == h and 512 <= w <= 2048, (w, h)
    assert len(raw) < 2 * 1024 * 1024
