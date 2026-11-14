// T09: static BRIEF audit of the files T09 owns (Settings, Portfolio, Runtime,
// Scheduled pages plus components/settings and components/portfolio).
// Reads source only; offline and deterministic.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

const listTsx = (dir: string) =>
  fs.readdirSync(path.join(SRC, dir))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `${dir}/${f}`);

const PAGES = ["pages/Settings.tsx", "pages/Portfolio.tsx", "pages/Runtime.tsx", "pages/Scheduled.tsx"];
const OWNED = [...PAGES, ...listTsx("components/settings"), ...listTsx("components/portfolio")];

type Hit = { file: string; line: number; text: string };

/** Strip line comments and block-comment lines so prose in comments is not flagged. */
function codeLines(src: string): string[] {
  let inBlock = false;
  return src.split("\n").map((line) => {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      return "";
    }
    if (trimmed.startsWith("/*") || trimmed.startsWith("{/*")) {
      if (!trimmed.includes("*/")) inBlock = true;
      return "";
    }
    if (trimmed.startsWith("*") || trimmed.startsWith("//")) return "";
    return line;
  });
}

function scan(re: RegExp, files = OWNED): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    codeLines(read(file)).forEach((text, i) => {
      re.lastIndex = 0;
      if (re.test(text)) hits.push({ file, line: i + 1, text: text.trim() });
    });
  }
  return hits;
}

describe("T09 owned file set", () => {
  it("covers the four pages, every settings and portfolio component, and the new files", () => {
    expect(OWNED).toEqual(expect.arrayContaining([
      ...PAGES,
      "components/settings/ClaudeSettings.tsx",
      "components/settings/SecretInput.tsx",
      "components/settings/ChannelSettings.tsx",
      "components/settings/ChannelConfigPanel.tsx",
      "components/settings/CustomProviderManager.tsx",
      "components/settings/SourcePrioritySettings.tsx",
      "components/settings/ModelPicker.tsx",
      "components/portfolio/ConnectionCenter.tsx",
      "components/portfolio/PortfolioSourceEditor.tsx",
      "components/portfolio/RebalanceProposal.tsx",
      "components/portfolio/ExtraEtfImport.tsx",
      "components/portfolio/PortfolioCompatibilityBadge.tsx",
    ]));
    expect(OWNED.some((f) => f.includes("__tests__"))).toBe(false);
  });
});

describe("T09 banned patterns (zero hits in code)", () => {
  const cases: [string, RegExp][] = [
    ["uppercase class", /(^|[\s"'`{])uppercase([\s"'`}]|$)/],
    ["wide letter spacing", /tracking-(wide|wider|widest)/],
    ["serif font", /font-serif/],
    ["gradient background", /bg-(gradient|linear|radial|conic)-/],
    ["gradient stops", /(^|[\s"'`])(from|via|to)-(primary|accent|purple|violet|indigo|fuchsia|pink|blue|sky|amber|emerald|transparent|background|card|muted|white|black)(-\d{2,3})?(\/\d+)?([\s"'`]|$)/],
    ["glow shadow class", /(^|[\s"'`:])shadow-(sm|md|xl|2xl|inner|\[|primary|accent|success|danger)/],
    ["decorative pulse", /animate-pulse/],
    ["ping animation", /animate-ping/],
    ["literal em dash", /—/],
    ["large radius", /rounded-(xl|2xl|3xl)/],
    ["sub-12px text", /text-\[(6|7|8|9|10|11)px\]/],
    ["tiny Tailwind text", /(^|[\s"'`])text-(2xs|xxs)([\s"'`]|$)/],
    ["blur glow", /blur-(sm|md|lg|xl|2xl|3xl)|backdrop-blur/],
    ["undefined text-positive token", /text-positive/],
    ["beige palette", /(bg|text|border)-(stone|amber)-(50|100|200)/],
  ];

  it.each(cases)("no %s in owned files", (_name, re) => {
    expect(scan(re)).toEqual([]);
  });

  it("shadow-lg only on popovers and drawers (BRIEF allows it there)", () => {
    const hits = scan(/(^|[\s"'`:])shadow-lg/);
    for (const hit of hits) {
      expect(hit.file).toMatch(/ModelPicker|ConnectionCenter|PortfolioSourceEditor/);
    }
  });

  it("no escaped em dash or &mdash; that renders as an em dash", () => {
    expect(scan(/\\u2014|&mdash;|&#8212;|\\u\{2014\}/)).toEqual([]);
  });

  it("no emoji pictographs", () => {
    expect(scan(/\p{Extended_Pictographic}/u)).toEqual([]);
  });

  it("no 01/02/03 style counters", () => {
    expect(scan(/["'`>]0[1-9]["'`<]|padStart\(2,\s*["']0["']\)\s*}?\s*[./]/)).toEqual([]);
  });

  it("no purple or violet palette utilities", () => {
    expect(scan(/(text|bg|border|ring|fill|stroke)-(purple|violet|fuchsia|indigo|pink)-\d{2,3}/)).toEqual([]);
  });

  it("no raw Tailwind palette colors (tokens only)", () => {
    expect(scan(/(^|[\s"'`:])(text|bg|border|ring)-(emerald|amber|sky|orange|rose|lime|teal|cyan|yellow|red|green|blue|slate|gray|zinc|stone|neutral)-\d{2,3}/)).toEqual([]);
  });

  it("no raw hex color literals (charts read getChartTheme)", () => {
    expect(scan(/["'`]#[0-9a-fA-F]{3,8}["'`]/)).toEqual([]);
  });

  it("only allowed non-ASCII glyphs remain in code: middle dot, masking bullet, en dash, CJK axis units", () => {
    const hits = scan(/[^\x00-\x7F]/u).filter((hit) => /[^\x00-\x7F·•–¥万亿]/u.test(hit.text));
    expect(hits).toEqual([]);
  });
});

describe("T09 uses the design-system primitives", () => {
  const importsUi = (file: string) => /from ["']@\/components\/ui["']/.test(read(file));

  it.each(PAGES)("%s imports from @/components/ui and renders Page + PageHeader", (file) => {
    const src = read(file);
    expect(importsUi(file)).toBe(true);
    expect(src).toMatch(/<Page\b/);
    expect(src).toMatch(/<PageHeader\b/);
  });

  it("Settings uses a narrow page, the other three use wide pages", () => {
    expect(read("pages/Settings.tsx")).toMatch(/<Page width="narrow">/);
    for (const file of ["pages/Portfolio.tsx", "pages/Runtime.tsx", "pages/Scheduled.tsx"]) {
      expect(read(file)).toMatch(/<Page width="wide">/);
    }
  });

  it("Portfolio and Scheduled lists use the Table primitive", () => {
    for (const file of ["pages/Portfolio.tsx", "pages/Scheduled.tsx"]) {
      const src = read(file);
      expect(src).toMatch(/<Table\b/);
      expect(src).toMatch(/<THead>/);
      expect(src).not.toMatch(/<table\b/);
    }
  });

  it("Settings has no app API auth key field (ADR 0002)", () => {
    const src = read("pages/Settings.tsx");
    expect(src).not.toMatch(/apiAuthKey|setApiAuthKey|getApiAuthKey|@\/lib\/apiAuth/);
  });

  it("ClaudeSettings reads status from @/lib/claudeChat and does not hand-roll fetch", () => {
    const src = read("components/settings/ClaudeSettings.tsx");
    expect(src).toMatch(/getClaudeStatus/);
    expect(src).toMatch(/from ["']@\/lib\/claudeChat["']/);
    expect(src).not.toMatch(/\bfetch\(/);
  });

  it("does not import locale JSON or add new dependencies to owned files", () => {
    for (const file of OWNED) {
      expect(read(file)).not.toMatch(/locales\/.*\.json/);
    }
  });
});
