// T08: static BRIEF audit of the files T08 owns (Agent, RunDetail, Compare,
// Reports, components/chat, components/run). Reads source only; offline.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

const listTsx = (dir: string) =>
  fs.readdirSync(path.join(SRC, dir))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `${dir}/${f}`);

const PAGES = ["pages/Agent.tsx", "pages/RunDetail.tsx", "pages/Compare.tsx", "pages/Reports.tsx"];
const OWNED = [...PAGES, ...listTsx("components/chat"), ...listTsx("components/run")];

type Hit = { file: string; line: number; text: string };

function scan(re: RegExp, files = OWNED): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    read(file).split("\n").forEach((text, i) => {
      re.lastIndex = 0;
      if (re.test(text)) hits.push({ file, line: i + 1, text: text.trim() });
    });
  }
  return hits;
}

describe("T08 owned file set", () => {
  it("covers the four pages and every chat and run component", () => {
    expect(OWNED).toEqual(expect.arrayContaining([
      ...PAGES,
      "components/chat/WelcomeScreen.tsx",
      "components/chat/MessageBubble.tsx",
      "components/chat/Composer.tsx",
      "components/chat/ProgressBar.tsx",
      "components/chat/ActivityLine.tsx",
      "components/chat/ToolProgressIndicator.tsx",
      "components/chat/ThinkingTimeline.tsx",
      "components/chat/RunCompleteCard.tsx",
      "components/chat/MetricsCard.tsx",
      "components/chat/MandateProposalCard.tsx",
      "components/chat/ScheduledResearchProposalCard.tsx",
      "components/chat/SwarmStatusCard.tsx",
      "components/chat/GoalPanel.tsx",
      "components/chat/LiveRuntimePanel.tsx",
      "components/run/RunCard.tsx",
      "components/run/LlmUsagePanel.tsx",
      "components/run/PositionsTab.tsx",
    ]));
    expect(OWNED.some((f) => f.includes("__tests__"))).toBe(false);
  });
});

describe("T08 banned patterns (zero hits)", () => {
  const cases: [string, RegExp][] = [
    ["uppercase class", /(^|[\s"'`{])uppercase([\s"'`}]|$)/],
    ["wide letter spacing", /tracking-(wider|widest)/],
    ["serif font", /font-serif/],
    ["gradient background", /bg-(gradient|linear|radial|conic)-/],
    ["gradient stops", /(^|[\s"'`])(from|via|to)-(primary|accent|purple|violet|indigo|fuchsia|pink|blue|sky|amber|emerald|transparent|background|card|muted|white|black)(-\d{2,3})?(\/\d+)?([\s"'`]|$)/],
    ["shadow glow class", /(^|[\s"'`:])shadow-(sm|md|lg|xl|2xl|inner|\[|primary|accent|success|danger)/],
    ["decorative pulse", /animate-pulse/],
    ["ping animation", /animate-ping/],
    ["literal em dash", /—/],
    ["large radius", /rounded-(xl|2xl|3xl)/],
    ["sub-12px text", /text-\[(8|9|10|11)px\]/],
    ["tiny Tailwind text", /(^|[\s"'`])text-(2xs|xxs)([\s"'`]|$)/],
    ["blur glow", /blur-(2xl|3xl)|backdrop-blur/],
  ];

  it.each(cases)("no %s in owned files", (_name, re) => {
    expect(scan(re)).toEqual([]);
  });

  it("no escaped em dash or &mdash; that renders as an em dash in the UI", () => {
    expect(scan(/\\u2014|&mdash;|&#8212;|\\u\{2014\}/)).toEqual([]);
  });

  it("no emoji pictographs in owned files", () => {
    expect(scan(/\p{Extended_Pictographic}/u)).toEqual([]);
  });

  it("no 01/02/03 style counters", () => {
    expect(scan(/["'`>]0[1-9]["'`<]|padStart\(2,\s*["']0["']\)\s*}?\s*[./]/)).toEqual([]);
  });

  it("no purple or violet palette utility classes", () => {
    expect(scan(/(text|bg|border|ring|fill|stroke)-(purple|violet|fuchsia|indigo)-\d{2,3}/)).toEqual([]);
  });

  it("no raw Tailwind palette colors (tokens only)", () => {
    expect(scan(/(^|[\s"'`:])(text|bg|border|ring)-(emerald|amber|sky|orange|rose|lime|teal|cyan|yellow|red|green|blue|slate|gray|zinc|stone|neutral)-\d{2,3}/)).toEqual([]);
  });
});

describe("T08 raw hex colors are confined to ECharts literals", () => {
  const HEX = /["'`]#[0-9a-fA-F]{3,8}["'`]/g;
  const hexByFile = () => {
    const out: Record<string, string[]> = {};
    for (const file of OWNED) {
      const found = read(file).match(HEX);
      if (found) out[file] = found.map((h) => h.slice(1, -1).toLowerCase());
    }
    return out;
  };

  it("only Compare and PositionsTab carry color literals", () => {
    expect(Object.keys(hexByFile()).sort()).toEqual([
      "components/run/PositionsTab.tsx",
      "pages/Compare.tsx",
    ]);
  });

  it("Compare fallbacks are the BRIEF compare tokens, used only behind var lookups", () => {
    const src = read("pages/Compare.tsx");
    expect(hexByFile()["pages/Compare.tsx"]).toEqual(["#1555e0", "#b36205"]);
    expect(src).toMatch(/getPropertyValue\("--chart-compare-a"\)\.trim\(\) \|\| "#1555E0"/);
    expect(src).toMatch(/getPropertyValue\("--chart-compare-b"\)\.trim\(\) \|\| "#B36205"/);
  });

  function hue(hex: string): { h: number; s: number } {
    const n = hex.replace("#", "");
    const full = n.length === 3 ? n.split("").map((c) => c + c).join("") : n.slice(0, 6);
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return { h: 0, s: 0 };
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    return { h, s: d / (1 - Math.abs(max + min - 1)) };
  }

  it("PositionsTab palette has no purple, magenta or pink hues", () => {
    const hexes = hexByFile()["components/run/PositionsTab.tsx"];
    expect(hexes.length).toBeGreaterThan(0);
    const offenders = hexes.filter((h) => {
      const { h: deg, s } = hue(h);
      return s > 0.15 && deg >= 255 && deg <= 345;
    });
    expect(offenders).toEqual([]);
  });

  it("PositionsTab palette has no beige or tan tones", () => {
    const offenders = hexByFile()["components/run/PositionsTab.tsx"].filter((h) => {
      const { h: deg, s } = hue(h);
      const light = parseInt(h.slice(1, 3), 16) > 200;
      return deg >= 25 && deg <= 50 && s < 0.6 && light;
    });
    expect(offenders).toEqual([]);
  });
});

describe("T08 layout contracts in source", () => {
  it("Agent page is full width: no Page wrapper, centered max-w-3xl column for timeline and composer", () => {
    const src = read("pages/Agent.tsx");
    expect(src).not.toMatch(/<Page[\s>]/);
    expect(src.match(/max-w-3xl mx-auto px-4/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("RunDetail uses Page width wide for loading, not found and loaded states", () => {
    const src = read("pages/RunDetail.tsx");
    expect(src.match(/<Page width="wide">/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(src).toMatch(/<PageHeader/);
    expect(src).toMatch(/<Tabs\b/);
    expect(src).toMatch(/from_run=\$\{encodeURIComponent\(runId\)\}/);
  });

  it("Compare and Reports use Page and PageHeader with Table primitives", () => {
    for (const file of ["pages/Compare.tsx", "pages/Reports.tsx"]) {
      const src = read(file);
      expect(src, file).toMatch(/<Page\b/);
      expect(src, file).toMatch(/<PageHeader\b/);
      expect(src, file).toMatch(/<Table>/);
      expect(src, file).not.toMatch(/<table\b/);
    }
  });

  it("pages and run components do not render raw <table> elements (Table primitive only)", () => {
    expect(scan(/<table\b/, [...PAGES, ...listTsx("components/run")])).toEqual([]);
  });

  it("WelcomeScreen has no serif greeting and a 2-column prompt grid", () => {
    const src = read("components/chat/WelcomeScreen.tsx");
    expect(src).toMatch(/<h1 className="text-xl font-semibold">/);
    expect(src).toMatch(/text-\[13px\] text-muted-foreground/);
    expect(src).toMatch(/sm:grid-cols-2/);
  });

  it("chat cards build on the Card primitive", () => {
    for (const file of [
      "components/chat/MetricsCard.tsx",
      "components/chat/RunCompleteCard.tsx",
    ]) {
      expect(read(file), file).toMatch(/from "@\/components\/ui"/);
    }
  });

  it("Composer uses ui Button primitives inside a bordered rounded-lg bg-card container", () => {
    const src = read("components/chat/Composer.tsx");
    expect(src).toMatch(/import \{[^}]*\bButton\b[^}]*\} from "@\/components\/ui"/);
    expect(src).toMatch(/rounded-lg[^"]*bg-card|bg-card[^"]*rounded-lg/);
  });
});
