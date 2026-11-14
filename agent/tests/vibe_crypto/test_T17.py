"""T17: Claude Desktop MCPB extension, release attachment, desktop version 0.4.0 (offline)."""
import fnmatch
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
EXT = ROOT / "extensions" / "claude-desktop"
WF = ROOT / ".github" / "workflows" / "desktop-windows.yml"
ASSET = "vibe-crypto-claude-desktop.mcpb"


def _manifest():
    return json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))


def test_versions_aligned():
    pkg = json.loads((ROOT / "desktop/electron/package.json").read_text(encoding="utf-8"))
    lock = json.loads((ROOT / "desktop/electron/package-lock.json").read_text(encoding="utf-8"))
    assert _manifest()["version"] == pkg["version"] == lock["version"] == lock["packages"][""]["version"] == "0.4.0"


def test_manifest_launches_uvx_from_github():
    m = _manifest()
    assert (EXT / m["icon"]).is_file()
    cfg = m["server"]["mcp_config"]
    assert cfg["command"] == "uvx"
    assert "vibe-crypto-mcp" in cfg["args"]
    assert any("github.com/buckleson/vibe-trading-crypto" in a for a in cfg["args"])
    assert cfg["env"]["VIBE_CRYPTO_MCP_ENABLE_ORDERS"] == "${user_config.enable_order_tools}"
    assert m["user_config"]["enable_order_tools"]["default"] is False
    assert m["user_config"]["extra_packages"]["default"] == "keyring"


def test_workflow_packs_uploads_and_releases_mcpb():
    wf = WF.read_text(encoding="utf-8")
    assert wf.count("@anthropic-ai/mcpb@2.1.2") >= 2
    step = wf[wf.index("- name: Build Claude Desktop extension"):wf.index("- name: Upload installer")]
    assert f"release\\{ASSET}" in step and "pack" in step and "validate" in step
    upload = wf[wf.index("- name: Upload installer"):wf.index("- name: Publish GitHub Release")]
    assert f"desktop/electron/release/{ASSET}" in upload
    create = [l for l in wf.splitlines() if l.strip().startswith("gh release create")]
    assert len(create) == 1 and f"release\\{ASSET}" in create[0]


def test_first_filter_is_installer_filter():
    wf = WF.read_text(encoding="utf-8")
    filt = re.search(r"-Filter '([^']+)'", wf).group(1)
    assert fnmatch.fnmatch("Vibe-Crypto-0.4.0-win-x64.exe", filt)


def test_no_em_dash_or_emoji_in_extension():
    for f in EXT.iterdir():
        if f.suffix in {".json", ".md", ".mcpbignore"} or f.name == ".mcpbignore":
            text = f.read_text(encoding="utf-8")
            assert "\u2014" not in text, f
            assert not re.search("[\U0001F300-\U0001FAFF\u2600-\u27bf]", text), f


# ---------------------------------------------------------------------------
# Test-engineer additions (edge cases). Offline unless npx has mcpb cached.
# ---------------------------------------------------------------------------
import os
import shutil
import struct
import subprocess
import sys
import zipfile

import pytest
import yaml

ZIP_SRC = "https://github.com/buckleson/vibe-trading-crypto/archive/refs/heads/main.zip"
STABLE_URL = f"https://github.com/buckleson/vibe-trading-crypto/releases/latest/download/{ASSET}"
MCPB = "@anthropic-ai/mcpb@2.1.2"


def _wf_steps():
    doc = yaml.safe_load(WF.read_text(encoding="utf-8"))
    (job,) = doc["jobs"].values()
    return job["steps"]


def _step(name):
    return next(s for s in _wf_steps() if s.get("name") == name)


def test_manifest_core_fields():
    m = _manifest()
    assert m["manifest_version"] == "0.3"
    assert m["name"] == "vibe-crypto" and m["display_name"] == "Vibe Crypto"
    assert re.fullmatch(r"\d+\.\d+\.\d+", m["version"])
    assert m["server"]["type"] == "binary"
    assert m["server"]["entry_point"] == "uvx"
    assert set(m["compatibility"]["platforms"]) == {"darwin", "win32", "linux"}
    assert m["documentation"].endswith("guides/share-with-friends.md")


def test_mcp_config_arg_order():
    args = _manifest()["server"]["mcp_config"]["args"]
    assert args[args.index("--python") + 1] == "3.12"
    assert args[args.index("--with") + 1] == "${user_config.extra_packages}"
    assert args[args.index("--from") + 1] == ZIP_SRC
    assert args[-1] == "vibe-crypto-mcp"
    # no transport flags: stdio default; no token/host flags in a local extension
    assert not any(a.startswith(("--transport", "--token", "--host")) for a in args)


def test_every_placeholder_is_defined_and_used():
    m = _manifest()
    blob = json.dumps(m["server"]["mcp_config"])
    used = set(re.findall(r"\$\{user_config\.([A-Za-z0-9_]+)\}", blob))
    assert used == set(m["user_config"])
    # no other placeholder families (e.g. __dirname) because nothing is bundled
    assert set(re.findall(r"\$\{([A-Za-z_]+)", blob)) == {"user_config"}


def test_user_config_types_and_safe_defaults():
    uc = _manifest()["user_config"]
    assert uc["extra_packages"]["type"] == "string" and uc["extra_packages"]["required"] is True
    assert "keyring" in uc["extra_packages"]["default"].split(",")
    eo = uc["enable_order_tools"]
    assert eo["type"] == "boolean" and eo["default"] is False and eo["required"] is False
    assert "ask" in eo["description"].lower()


@pytest.mark.parametrize("val,expected", [("true", True), ("false", False), ("True", True), ("", False)])
def test_order_env_values_from_claude_desktop_parse(val, expected):
    # Claude Desktop substitutes a boolean user_config as "true"/"false".
    sys.path.insert(0, str(ROOT / "agent"))
    from src.config.env_schema import _parse_env_bool

    assert _parse_env_bool(val) is expected


def test_icon_is_square_png_at_most_512():
    data = (EXT / _manifest()["icon"]).read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    w, h = struct.unpack(">II", data[16:24])
    assert w == h and 0 < w <= 512


def test_mcpbignore_keeps_only_three_files():
    lines = [l.strip() for l in (EXT / ".mcpbignore").read_text(encoding="utf-8").splitlines() if l.strip()]
    assert lines[0] == "*"
    assert sorted(l[1:] for l in lines[1:]) == ["README.md", "icon.png", "manifest.json"]
    assert all(l.startswith("!") for l in lines[1:])


def test_gitignore_ignores_mcpb():
    gi = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert "*.mcpb" in [l.strip() for l in gi]


def test_readme_covers_install_and_troubleshooting():
    r = (EXT / "README.md").read_text(encoding="utf-8")
    assert STABLE_URL in r
    assert "curl -LsSf https://astral.sh/uv/install.sh | sh" in r
    assert 'irm https://astral.sh/uv/install.ps1 | iex' in r
    args = _manifest()["server"]["mcp_config"]["args"]
    warm = "uvx " + " ".join(a.replace("${user_config.extra_packages}", "keyring") for a in args)
    assert warm in r, "warm-up must be the manifest's exact command with keyring"
    assert "--refresh" in r and "which uvx" in r and "where uvx" in r
    assert "Settings > Extensions" in r
    assert f"npx --yes {MCPB} pack extensions/claude-desktop {ASSET}" in r
    assert "../../guides/share-with-friends.md" in r


def test_baseline_version_no_longer_pinned():
    t01 = (ROOT / "agent/tests/vibe_crypto/test_T01.py").read_text(encoding="utf-8")
    assert 'electron_pkg["version"] == base["version"]' not in t01
    assert "bumped for releases (ADR 0008)" in t01
    mjs = (ROOT / "desktop/electron/scripts/test-rebrand-T01.mjs").read_text(encoding="utf-8")
    assert "assert.equal(pkg.version, base.version)" not in mjs
    assert "bumped for releases (ADR 0008)" in mjs


def test_workflow_step_order_and_shape():
    names = [s.get("name") for s in _wf_steps()]
    i = names.index
    assert (
        i("Verify installer, record checksum and zip win-unpacked")
        < i("Build Claude Desktop extension")
        < i("Upload installer")
        < i("Publish GitHub Release")
    )
    st = _step("Build Claude Desktop extension")
    assert st["shell"] == "powershell" and st["working-directory"] == "desktop/electron"
    assert "if" not in st, "the extension must build on every run, not only on main"
    run = st["run"]
    for needle in (
        "$manifest.version -ne $version",
        f"npx --yes {MCPB} validate ..\\..\\extensions\\claude-desktop\\manifest.json",
        f"npx --yes {MCPB} pack ..\\..\\extensions\\claude-desktop release\\{ASSET}",
        "release\\SHA256SUMS.txt",
        "Get-FileHash",
    ):
        assert needle in run, needle
    # each npx call is followed by an exit-code check
    lines = [l.strip() for l in run.splitlines()]
    for k, l in enumerate(lines):
        if l.startswith("npx "):
            assert lines[k + 1].startswith("if ($LASTEXITCODE -ne 0) { throw")
    assert "-Filter" not in run


def test_upload_and_release_include_mcpb():
    up = _step("Upload installer")["with"]["path"].split()
    assert f"desktop/electron/release/{ASSET}" in up
    assert "desktop/electron/release/SHA256SUMS.txt" in up
    run = _step("Publish GitHub Release")["run"]
    assert "Release $tag already exists; skipping." in run
    create = next(l for l in run.splitlines() if l.startswith("gh release create"))
    assert create.index("release\\SHA256SUMS.txt") < create.index(f"release\\{ASSET}") < create.index("--target")


def test_release_notes_here_string_valid():
    run = _step("Publish GitHub Release")["run"]
    lines = run.splitlines()
    start = next(k for k, l in enumerate(lines) if l.rstrip().endswith('@"'))
    end = next(k for k, l in enumerate(lines) if k > start and l.startswith('"@'))
    notes = "\n".join(lines[start + 1 : end])
    assert lines[end] == '"@'
    for needle in (
        ASSET,
        "Settings > Extensions",
        "https://docs.astral.sh/uv/",
        "/plugin marketplace add buckleson/vibe-trading-crypto",
        "/plugin install vibe-crypto@vibe-crypto",
        "guides/share-with-friends.md",
    ):
        assert needle in notes, needle


def test_workflow_header_mentions_mcpb():
    head = WF.read_text(encoding="utf-8").split("\non:", 1)[0]
    assert ASSET in head


def test_no_em_dash_in_workflow_additions():
    wf = WF.read_text(encoding="utf-8")
    seg = wf[wf.index("- name: Build Claude Desktop extension"):]
    assert "\u2014" not in seg


def _npx_mcpb(*args, cwd=None):
    npx = shutil.which("npx")
    if not npx:
        pytest.skip("npx not installed")
    env = dict(os.environ, npm_config_yes="true")
    # conftest sandboxes HOME; point npm at the real user cache so --offline finds mcpb.
    if "npm_config_cache" not in os.environ:
        try:
            import pwd

            env["npm_config_cache"] = os.path.join(pwd.getpwuid(os.getuid()).pw_dir, ".npm")
        except ImportError:  # Windows: npm cache lives under LOCALAPPDATA, not HOME
            pass
    try:
        p = subprocess.run([npx, "--offline", "--yes", MCPB, *args], cwd=cwd, env=env,
                           capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        pytest.skip("npx mcpb timed out")
    if "ENOTCACHED" in p.stderr or "could not determine executable" in p.stderr:
        pytest.skip("mcpb 2.1.2 not in the npx cache (offline)")
    return p


def test_mcpb_validate_passes():
    p = _npx_mcpb("validate", str(EXT / "manifest.json"))
    assert p.returncode == 0, p.stdout + p.stderr
    assert "passes" in (p.stdout + p.stderr).lower()


def test_mcpb_pack_has_only_three_files(tmp_path):
    out = tmp_path / ASSET
    p = _npx_mcpb("pack", str(EXT), str(out))
    assert p.returncode == 0, p.stdout + p.stderr
    with zipfile.ZipFile(out) as z:
        names = sorted(n for n in z.namelist() if not n.endswith("/"))
        assert names == ["README.md", "icon.png", "manifest.json"]
        assert json.loads(z.read("manifest.json")) == _manifest()


def test_mcpb_validate_rejects_broken_manifest(tmp_path):
    bad = _manifest()
    del bad["server"]
    f = tmp_path / "manifest.json"
    f.write_text(json.dumps(bad), encoding="utf-8")
    p = _npx_mcpb("validate", str(f))
    assert p.returncode != 0
