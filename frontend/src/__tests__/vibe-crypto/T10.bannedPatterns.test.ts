// T10: static BRIEF audit of the files T10 owns: the analysis pages
// (AlphaZoo, ResearchLab, ResearchArtifacts, OptionsLab, Correlation,
// PixelOffice), components/options/** and components/charts/**, plus the
// pixel-office block of index.css. Reads source only; offline and deterministic.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
const listTsx = (dir: string) =>
  fs.readdirSync(path.join(SRC, dir)).filter((f) => /\.tsx?$/.test(f)).map((f) => `${dir}/${f}`);

const PAGES = ["AlphaZoo", "ResearchLab", "ResearchArtifacts", "OptionsLab", "Correlation", "PixelOffice"].map((p) => `pages/${p}.tsx`);
const OPTIONS = listTsx("components/options");
const CHARTS = listTsx("components/charts");
const OWNED = [...PAGES, ...OPTIONS, ...CHARTS];
const CHART_TOKENS = "components/charts/chartTokens.ts";

type Hit = { file: string; line: number; text: string };

/** Blank out comment-only lines so prose in comments is not flagged. */
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
    return line.replace(/\s\/\/\s.*$/, "");
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

describe("T10 owned file set", () => {
  it("includes the six pages, every options component and every chart component", () => {
    expect(OWNED).toEqual(expect.arrayContaining([
      ...PAGES,
      "components/options/GreeksCards.tsx",
      "components/options/OptionsChainTable.tsx",
      "components/options/PayoffComparisons.tsx",
      "components/options/StrategyBuilder.tsx",
      "components/options/VolatilitySurfaceGrid.tsx",
      "components/charts/CorrelationMatrix.tsx",
      "components/charts/EquityChart.tsx",
      "components/charts/CandlestickChart.tsx",
      "components/charts/ShannonPortfolio.tsx",
      "components/charts/WalkForwardChart.tsx",
      CHART_TOKENS,
    ]));
    expect(OWNED.some((f) => f.includes("__tests__"))).toBe(false);
  });
});

describe("T10 banned patterns (zero hits in code)", () => {
  const cases: [string, RegExp][] = [
    ["uppercase class", /(^|[\s"'`{])uppercase([\s"'`}]|$)/],
    ["CSS text-transform uppercase", /textTransform:\s*["']uppercase/],
    ["letter spacing utilities", /tracking-(wide|wider|widest|tight|tighter|\[)/],
    ["serif font", /font-serif/],
    ["gradient background utility", /bg-(gradient|linear|radial|conic)-/],
    ["CSS gradient function", /(linear|radial|conic)-gradient\(/],
    ["ECharts LinearGradient", /LinearGradient|RadialGradient/],
    ["ECharts colorStops", /colorStops/],
    ["gradient stops", /(^|[\s"'`])(from|via|to)-(primary|accent|purple|violet|indigo|fuchsia|pink|blue|sky|amber|emerald|transparent|background|card|muted|white|black)(-\d{2,3})?(\/\d+)?([\s"'`]|$)/],
    ["glow shadow class", /(^|[\s"'`:])shadow-(sm|md|lg|xl|2xl|inner|\[|primary|accent|success|danger)/],
    ["drop-shadow filter", /drop-shadow/],
    ["ECharts shadowBlur glow", /shadowBlur|shadowColor/],
    ["decorative pulse", /animate-pulse/],
    ["ping/bounce animation", /animate-(ping|bounce)/],
    ["literal em dash", /—/],
    ["large radius", /rounded-(xl|2xl|3xl)/],
    ["sub-12px arbitrary text", /text-\[(6|7|8|9|10|11)(\.\d+)?px\]/],
    ["tiny Tailwind text", /(^|[\s"'`])text-(2xs|xxs)([\s"'`]|$)/],
    ["blur glow", /(^|[\s"'`])blur-(sm|md|lg|xl|2xl|3xl)|backdrop-blur/],
    ["beige palette", /(bg|text|border)-(stone|amber|orange)-(50|100|200)/],
    ["purple palette utility", /(text|bg|border|ring|fill|stroke)-(purple|violet|fuchsia|indigo|pink)-\d{2,3}/],
    ["raw Tailwind palette color", /(^|[\s"'`:])(text|bg|border|ring)-(emerald|amber|sky|orange|rose|lime|teal|cyan|yellow|red|green|blue|slate|gray|zinc|stone|neutral)-\d{2,3}/],
    ["mono uppercase label", /font-mono[^"'`]*uppercase|uppercase[^"'`]*font-mono/],
  ];

  it.each(cases)("no %s in owned files", (_name, re) => {
    expect(scan(re)).toEqual([]);
  });

  it("no escaped em dash or &mdash;", () => {
    expect(scan(/\\u2014|&mdash;|&#8212;|\\u\{2014\}/)).toEqual([]);
  });

  it("no emoji pictographs", () => {
    expect(scan(/\p{Extended_Pictographic}/u)).toEqual([]);
  });

  it("no 01/02/03 style counters", () => {
    expect(scan(/["'`>]0[1-9]["'`<]|padStart\(2,\s*["']0["']\)\s*}?\s*[./]/)).toEqual([]);
  });

  it("no in-canvas ECharts title component (titles belong in CardHeader)", () => {
    // `title: {` at option level; toolbox `saveAsImage: { title: "Save" }` is a string and allowed.
    expect(scan(/(^|[\s,{])title:\s*\{\s*(text|show|left|top)/, CHARTS)).toEqual([]);
  });

  it("raw hex colors appear only in chartTokens.ts (and contrast text black/white)", () => {
    const files = OWNED.filter((f) => f !== CHART_TOKENS);
    expect(scan(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/, files).filter((h) => !/href=|to=|#\{/.test(h.text))).toEqual([]);
  });

  it("ECharts axis/legend/label fontSize literals are 11 or 12 (never below)", () => {
    const hits = scan(/fontSize:\s*(\d+(\.\d+)?)/, CHARTS)
      .flatMap((h) => [...h.text.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)].map((m) => ({ ...h, size: Number(m[1]) })))
      .filter((h) => h.size < 11);
    expect(hits).toEqual([]);
  });

  it("every ECharts tooltip in charts declares box-shadow:none", () => {
    for (const file of CHARTS) {
      const src = read(file);
      const tooltips = (src.match(/tooltip(Bg)?[^\n]*backgroundColor/g) ?? []).length + (src.match(/backgroundColor:\s*(t|theme)\.tooltipBg/g) ?? []).length;
      if (!/tooltipBg/.test(src)) continue;
      expect(tooltips, file).toBeGreaterThan(0);
      expect(src, file).toMatch(/box-shadow:\s*none/);
    }
  });

  it("charts that use echarts read colors from getChartTheme or chart tokens", () => {
    for (const file of CHARTS) {
      const src = read(file);
      if (!/useChartLifecycle|echarts\.init/.test(src)) continue;
      expect(src, file).toMatch(/getChartTheme\(|getPnlColors\(|tokenRgb\(/);
    }
  });
});

describe("T10 pages use the ui primitives", () => {
  it.each(PAGES)("%s imports from @/components/ui and renders Page + PageHeader", (file) => {
    const src = read(file);
    expect(src).toMatch(/from "@\/components\/ui"/);
    expect(src).toMatch(/<Page[\s>]/);
    expect(src).toMatch(/<PageHeader\b/);
  });

  it.each(OPTIONS)("%s imports ui primitives", (file) => {
    expect(read(file)).toMatch(/from "@\/components\/ui"/);
  });

  it("pages do not hand-roll an <h1> (PageHeader owns the page title)", () => {
    expect(scan(/<h1[\s>]/, PAGES)).toEqual([]);
  });

  it("options components do not use raw <button> (Button primitive instead)", () => {
    expect(scan(/<button[\s>]/, OPTIONS)).toEqual([]);
  });

  it("ShannonPortfolio has no raw <button> left (handoff: replaced by ui Button)", () => {
    expect(scan(/<button[\s>]/, ["components/charts/ShannonPortfolio.tsx"])).toEqual([]);
  });

  it("chart panels other than the CandlestickChart toolbar toggles do not use raw <button>", () => {
    // CandlestickChart range/indicator toggles are a compact segmented control inside the
    // chart frame; they are tracked separately in the T10 test notes.
    const files = CHARTS.filter((f) => !/CandlestickChart|ShannonPortfolio/.test(f));
    expect(scan(/<button[\s>]/, files)).toEqual([]);
  });

  it("OptionsChainTable uses Table primitives and tints ITM rows with bg-muted/40", () => {
    const src = read("components/options/OptionsChainTable.tsx");
    expect(src).toMatch(/\b(Table|THead|TBody|TR|TD|TH)\b/);
    expect(src).toMatch(/bg-muted\/40/);
  });

  it("VolatilitySurfaceGrid derives its scale from --primary only (single hue) and ships a legend", () => {
    const src = read("components/options/VolatilitySurfaceGrid.tsx");
    expect(src).toMatch(/hsl\(var\(--primary\) \/ \$\{/);
    expect(src).not.toMatch(/var\(--(danger|success|warning|info)\)/);
    expect(src).toMatch(/options\.surface\.legend/);
  });

  it("CorrelationMatrix diverging scale is built from --danger, --muted and --primary tokens", () => {
    const src = read("components/charts/CorrelationMatrix.tsx");
    const order = ["--danger", "--muted", "--primary"].map((tok) => src.indexOf(`tokenRgb("${tok}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe("T10 pixel office CSS block", () => {
  const css = read("index.css");
  const start = css.indexOf(".pixel-office-floor");
  const endMarker = css.indexOf("@keyframes pixel-typing");
  const end = css.indexOf("}\n}", endMarker) + 3;
  const block = css.slice(start, end);
  const rule = (selector: string) => {
    const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
    return re.exec(block)?.[1] ?? "";
  };

  it("finds the block", () => {
    expect(start).toBeGreaterThan(-1);
    expect(endMarker).toBeGreaterThan(start);
    expect(block).toContain(".pixel-character__typing");
  });

  it("floor is bg-card with a subtle border grid at 0.35 alpha", () => {
    const floor = rule(".pixel-office-floor");
    expect(floor).toMatch(/background-color:\s*hsl\(var\(--card\)\)/);
    const gridLines = floor.match(/hsl\(var\(--border\) \/ 0\.35\)/g) ?? [];
    expect(gridLines.length).toBe(2);
    expect(floor).toMatch(/background-size:\s*\d+px \d+px/);
  });

  it("desks are bg-muted", () => {
    expect(rule(".pixel-desk")).toMatch(/background:\s*hsl\(var\(--muted\)\)/);
  });

  it("no drop-shadow, filter or text-shadow glow anywhere in the block", () => {
    expect(block).not.toMatch(/drop-shadow|filter\s*:|text-shadow/);
  });

  it("box-shadow is only used for hard-edged pixel sprite detail (zero blur), never a glow", () => {
    for (const m of block.matchAll(/box-shadow:\s*([^;]+);/g)) {
      for (const layer of m[1].split(/,(?![^(]*\))/)) {
        // "x y blur color": blur must be 0 for pixel art.
        const parts = layer.trim().split(/\s+/);
        expect(parts.length, layer).toBe(4);
        expect(parts[2], `blur in "${layer.trim()}"`).toBe("0");
      }
    }
  });

  it("characters keep their sprite color via --pixel-color", () => {
    expect(rule(".pixel-character__torso")).toMatch(/var\(--pixel-color\)/);
    expect(block).toMatch(/\.pixel-character__arm,\s*\.pixel-character__leg\s*\{[^}]*var\(--pixel-color\)/);
  });

  it("typing animation is disabled under prefers-reduced-motion", () => {
    expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.pixel-character__typing\s*\{[^}]*animation:\s*none/);
  });

  it("the only animation in the block is the typing indicator", () => {
    const animated = [...block.matchAll(/([.\w-]+)\s*\{[^}]*animation:\s*(?![\s]|none)[^;]+;/g)].map((m) => m[1]);
    expect(animated).toEqual([".pixel-character__typing"]);
  });

  it("PixelOffice renders the typing indicator only while an agent has load", () => {
    const src = read("pages/PixelOffice.tsx");
    expect(src).toMatch(/agent\.load > 0 && <span className="pixel-character__typing"/);
  });
});
