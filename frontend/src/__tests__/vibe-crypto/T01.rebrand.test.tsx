// T01: rebrand to Vibe Crypto (ADR 0001). Offline, deterministic checks of the
// frontend surfaces: HTML shell, package metadata, all 11 locales through the
// real i18n instance, the sidebar brand in the rendered Layout, and a source
// sweep for the old brand and the retired docs site.
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterAll, describe, expect, it, vi } from "vitest";

import i18n, { SUPPORTED_LANGUAGES } from "@/i18n";
import en from "@/i18n/locales/en.json";
import { Layout } from "@/components/layout/Layout";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useDarkMode", () => ({
  useDarkMode: () => ({ dark: false, toggle: vi.fn() }),
}));
vi.mock("@/lib/api", () => ({
  api: {
    listSessions: vi.fn().mockResolvedValue([]),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/stores/agent", () => ({
  useAgentStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ sseStatus: "connected", sseRetryAttempt: 0, streamingSessionId: null }),
}));

const FRONTEND = path.resolve(__dirname, "../../..");
const SRC = path.join(FRONTEND, "src");
const LOCALE_DIR = path.join(SRC, "i18n", "locales");
const OLD_BRAND = /Vibe[- ]Trading/;
const stripHeader = (s: string) => s.replaceAll("X-Vibe-Trading-Auth", "");

type Tree = { [k: string]: string | Tree };
function flatten(obj: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") Object.assign(out, flatten(v as Tree, full));
    else out[full] = v as string;
  }
  return out;
}

const localeFiles = fs
  .readdirSync(LOCALE_DIR)
  .filter((f) => f.endsWith(".json") && f !== "tsconfig.json")
  .sort();
const locales = Object.fromEntries(
  localeFiles.map((f) => [
    f.replace(/\.json$/, ""),
    flatten(JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, f), "utf8")) as Tree),
  ]),
);
const enFlat = flatten(en as unknown as Tree);

describe("T01 HTML shell", () => {
  const html = fs.readFileSync(path.join(FRONTEND, "index.html"), "utf8");

  it("has exactly one title and it is Vibe Crypto", () => {
    expect([...html.matchAll(/<title>(.*?)<\/title>/g)].map((m) => m[1])).toEqual(["Vibe Crypto"]);
  });

  it("has exactly one meta description with the agreed copy", () => {
    const descs = [...html.matchAll(/<meta name="description" content="([^"]*)"/g)].map((m) => m[1]);
    expect(descs).toEqual([
      "Vibe Crypto: research, backtest and paper trade crypto, stocks and more with Claude.",
    ]);
  });

  it("description copy follows the slop ban (no em dash)", () => {
    const desc = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(desc).not.toMatch(/—/);
  });

  it("does not mention the old brand anywhere", () => {
    expect(html).not.toMatch(OLD_BRAND);
  });
});

describe("T01 package metadata", () => {
  it("package.json and package-lock.json use vibe-crypto-frontend", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(FRONTEND, "package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(FRONTEND, "package-lock.json"), "utf8"));
    expect(pkg.name).toBe("vibe-crypto-frontend");
    expect(lock.name).toBe("vibe-crypto-frontend");
    expect(lock.packages[""].name).toBe("vibe-crypto-frontend");
    expect(lock.packages[""].version).toBe(pkg.version);
  });

  it.each(["logo.svg", "favicon.svg"])("%s carries no old brand", (svg) => {
    const file = path.join(FRONTEND, "public", svg);
    if (!fs.existsSync(file)) return;
    const text = fs.readFileSync(file, "utf8");
    expect(text).not.toMatch(OLD_BRAND);
    for (const m of text.matchAll(/<title>(.*?)<\/title>/gs)) expect(m[1]).toContain("Vibe Crypto");
  });
});

describe("T01 locale files", () => {
  it("ships all 11 locales registered in SUPPORTED_LANGUAGES", () => {
    expect(Object.keys(locales).sort()).toEqual(SUPPORTED_LANGUAGES.map((l) => l.code).sort());
    expect(localeFiles).toHaveLength(11);
  });

  it.each(Object.keys(locales))("%s has the same key set as en", (code) => {
    expect(Object.keys(locales[code]).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it.each(Object.keys(locales))("%s values never contain the old brand or docs site", (code) => {
    const offenders = Object.entries(locales[code]).filter(
      ([, v]) => typeof v === "string" && (OLD_BRAND.test(stripHeader(v)) || v.includes("vibetrading.wiki")),
    );
    expect(offenders).toEqual([]);
  });

  it.each(Object.keys(locales))("%s keeps the X-Vibe-Trading-Auth header name verbatim where used", (code) => {
    const withHeader = Object.entries(enFlat).filter(([, v]) => v.includes("X-Vibe-Trading-Auth"));
    for (const [key] of withHeader) {
      expect(locales[code][key]).toContain("X-Vibe-Trading-Auth");
      expect(locales[code][key]).not.toContain("X-Vibe-Crypto");
    }
  });

  it("no key path itself was renamed to mention the brand", () => {
    expect(Object.keys(enFlat).filter((k) => /crypto/i.test(k) && /vibe/i.test(k))).toEqual([]);
  });

  it.each(Object.keys(locales))("%s sidebar and docs labels say Vibe Crypto", (code) => {
    expect(locales[code]["layout.sidebar"]).toContain("Vibe Crypto");
    const docsLabels = Object.entries(locales[code]).filter(([k]) => k.endsWith(".docsLabel"));
    const enBranded = Object.entries(enFlat)
      .filter(([k, v]) => k.endsWith(".docsLabel") && v.includes("Vibe Crypto"))
      .map(([k]) => k);
    expect(enBranded.length).toBeGreaterThan(0);
    for (const key of enBranded) {
      expect(docsLabels.find(([k]) => k === key)?.[1]).toContain("Vibe Crypto");
    }
  });
});

describe("T01 runtime i18n", () => {
  const original = i18n.language;
  afterAll(async () => {
    await i18n.changeLanguage(original);
  });

  it.each(SUPPORTED_LANGUAGES.map((l) => l.code))(
    "%s resolves layout.sidebar to a Vibe Crypto string",
    async (code) => {
      await i18n.changeLanguage(code);
      const value = i18n.t("layout.sidebar");
      expect(value).toContain("Vibe Crypto");
      expect(value).not.toMatch(OLD_BRAND);
    },
  );

  it("unknown language falls back to the English brand string", async () => {
    await i18n.changeLanguage("xx-NOPE");
    expect(i18n.t("layout.sidebar")).toBe(enFlat["layout.sidebar"]);
  });
});

describe("T01 rendered Layout brand", () => {
  it("sidebar landmark and home link are labelled Vibe Crypto (real English i18n)", async () => {
    await i18n.changeLanguage("en");
    render(
      <MemoryRouter initialEntries={["/agent"]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/agent" element={<div>Agent content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("complementary", { name: "Vibe Crypto sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vibe Crypto" })).toBeInTheDocument();
    expect(screen.getAllByText("Vibe Crypto").length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").not.toMatch(OLD_BRAND);
  });
});

describe("T01 source sweep", () => {
  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(p);
      return /\.(ts|tsx|css|json|html)$/.test(e.name) ? [p] : [];
    });
  }
  const files = walk(SRC);

  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no vibetrading.wiki links remain in frontend/src", () => {
    expect(files.filter((f) => fs.readFileSync(f, "utf8").includes("vibetrading.wiki"))).toEqual([]);
  });

  it("no old product name remains outside the protected header name", () => {
    const offenders = files.filter((f) => OLD_BRAND.test(stripHeader(fs.readFileSync(f, "utf8"))));
    expect(offenders.map((f) => path.relative(FRONTEND, f))).toEqual([]);
  });

  it("no HKUDS upstream links remain in frontend/src", () => {
    expect(files.filter((f) => /github\.com\/HKUDS/i.test(fs.readFileSync(f, "utf8")))).toEqual([]);
  });

  it("i18n registry comment no longer references deleted README_xx files", () => {
    expect(fs.readFileSync(path.join(SRC, "i18n", "index.ts"), "utf8")).not.toContain("README_");
  });

  it("storage keys and DOM events kept their internal names", () => {
    const all = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
    // auth removed by T02 (ADR: no app auth)
    expect(all).not.toContain("vibe_trading_api_auth_key");
    expect(all).toContain("vibe:sessions-refresh");
    expect(all).toMatch(/vibe-analysis-v1:/);
    expect(all).not.toMatch(/vibe_crypto_api_auth_key|vibe-crypto:sessions|vibe-crypto-analysis/);
  });
});
