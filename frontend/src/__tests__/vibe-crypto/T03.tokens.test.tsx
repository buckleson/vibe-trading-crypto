// T03: design tokens, Tailwind config, boot background, brand artwork and
// a slop-ban sweep over the files T03 owns. Static, offline, deterministic:
// reads files from disk and renders BrandMark in jsdom.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BrandMark } from "@/components/common/BrandMark";

const FRONTEND = path.resolve(__dirname, "../../..");
const REPO = path.resolve(FRONTEND, "..");
const read = (p: string) => fs.readFileSync(p, "utf8");

const INDEX_CSS = read(path.join(FRONTEND, "src/index.css"));
const BRIEF = read(path.join(REPO, "cook/BRIEF.md"));

// ── helpers ──────────────────────────────────────────────────────────

function block(css: string, selector: string): string {
  const re = new RegExp(`(^|\\n)\\s*${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  if (!m) throw new Error(`no ${selector} block`);
  return m[2];
}

function vars(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** Parse the `| \`--token\` | \`value\` |` rows under a BRIEF heading. */
function briefTable(heading: string): Record<string, string> {
  const start = BRIEF.indexOf(heading);
  if (start < 0) throw new Error(`heading ${heading} missing in BRIEF`);
  const rest = BRIEF.slice(start + heading.length);
  const end = rest.search(/\n#{2,3} /);
  const section = end < 0 ? rest : rest.slice(0, end);
  const out: Record<string, string> = {};
  for (const m of section.matchAll(/^\|\s*`(--[\w-]+)`\s*\|\s*`([^`]+)`\s*\|/gm)) out[m[1]] = m[2].trim();
  return out;
}

const norm = (v: string) => v.replace(/\s+/g, " ").toLowerCase();

const ROOT_VARS = vars(block(INDEX_CSS, ":root"));
const DARK_VARS = vars(block(INDEX_CSS, ".dark"));
const BRIEF_LIGHT = briefTable("### Color, light");
const BRIEF_DARK = briefTable("### Color, dark");

// ── tokens ───────────────────────────────────────────────────────────

describe("T03 tokens: index.css matches cook/BRIEF.md", () => {
  it("BRIEF tables parse to the expected size (guards the parser)", () => {
    expect(Object.keys(BRIEF_LIGHT).length).toBe(23);
    expect(Object.keys(BRIEF_DARK).length).toBe(22);
  });

  it("light :root has exactly the BRIEF tokens and values", () => {
    expect(Object.keys(ROOT_VARS).sort()).toEqual(Object.keys(BRIEF_LIGHT).sort());
    for (const [k, v] of Object.entries(BRIEF_LIGHT)) expect([k, norm(ROOT_VARS[k])]).toEqual([k, norm(v)]);
  });

  it("dark .dark has exactly the BRIEF tokens and values (radius inherited)", () => {
    expect(Object.keys(DARK_VARS).sort()).toEqual(Object.keys(BRIEF_DARK).sort());
    for (const [k, v] of Object.entries(BRIEF_DARK)) expect([k, norm(DARK_VARS[k])]).toEqual([k, norm(v)]);
  });

  it.each([
    ["--background", "220 20% 98%", "222 24% 7%"],
    ["--primary", "221 83% 48%", "217 91% 64%"],
    ["--primary-foreground", "0 0% 100%", "222 47% 9%"],
    ["--popover", "0 0% 100%", "222 20% 13%"],
    ["--destructive", "0 72% 45%", "0 72% 50%"],
    ["--success", "152 62% 30%", "152 55% 50%"],
    ["--danger", "0 72% 45%", "0 80% 66%"],
    ["--chart-compare-a", "#1555E0", "#5090F7"],
    ["--chart-compare-b", "#B36205", "#F6AA28"],
  ])("spot check %s", (name, light, dark) => {
    expect(norm(ROOT_VARS[name])).toBe(norm(light));
    expect(norm(DARK_VARS[name])).toBe(norm(dark));
  });

  it("radius is 0.625rem and only defined once", () => {
    expect(ROOT_VARS["--radius"]).toBe("0.625rem");
    expect(INDEX_CSS.match(/--radius\s*:/g)).toHaveLength(1);
  });

  it("every HSL triplet is well formed", () => {
    for (const [k, v] of [...Object.entries(ROOT_VARS), ...Object.entries(DARK_VARS)]) {
      if (k.startsWith("--chart-compare") || k === "--radius") continue;
      expect([k, v]).toEqual([k, expect.stringMatching(/^\d{1,3} \d{1,3}% \d{1,3}%$/)]);
    }
  });

  it("no beige / umber / cream palette or comments remain", () => {
    expect(INDEX_CSS).not.toMatch(/umber|beige|cream|warm paper|parchment|sepia/i);
    // Warm, desaturated, light hues (the old paper look): hue 20-50, sat < 50%, light > 80%.
    for (const v of [...Object.values(ROOT_VARS), ...Object.values(DARK_VARS)]) {
      const m = v.match(/^(\d+) (\d+)% (\d+)%$/);
      if (!m) continue;
      const [h, s, l] = m.slice(1).map(Number);
      expect(h >= 20 && h <= 50 && s < 50 && l > 80, `beige-ish token ${v}`).toBe(false);
    }
  });

  it("no purple accent in tokens (hue 260-300)", () => {
    for (const v of [...Object.values(ROOT_VARS), ...Object.values(DARK_VARS)]) {
      const m = v.match(/^(\d+) (\d+)% /);
      if (m) expect(Number(m[1]) >= 260 && Number(m[1]) <= 300).toBe(false);
    }
  });
});

describe("T03 tokens: base layer rules", () => {
  const base = INDEX_CSS.slice(INDEX_CSS.indexOf("@layer base"));

  it("body sets font features and antialiasing", () => {
    expect(base).toMatch(/body\s*\{[^}]*font-feature-settings:\s*'cv11',\s*'ss01'/);
    expect(base).toMatch(/body\s*\{[^}]*-webkit-font-smoothing:\s*antialiased/);
  });

  it(":focus-visible clears the outline (rings come from classes)", () => {
    expect(base).toMatch(/:focus-visible\s*\{\s*outline:\s*none;?\s*\}/);
  });

  it("does not redefine .tabular-nums", () => {
    expect(INDEX_CSS).not.toMatch(/\.tabular-nums\s*\{/);
  });

  it("reduced motion rule targets everything except spinners", () => {
    const m = INDEX_CSS.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\*:not\(\.animate-spin\)\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(m![1]).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });

  it.each([
    [".pixel-office-floor"], [".pixel-character__typing"], ["@keyframes pixel-typing"],
    ["@keyframes msg-enter"], [".msg-enter {"], [".vt-bidi pre"], [".vt-bidi .katex"], [".katex-display"],
    ["@keyframes pulse-slide"],
  ])("keeps preserved rule %s", (needle) => {
    expect(INDEX_CSS).toContain(needle);
  });
});

describe("T03 tailwind config", () => {
  const TW = read(path.join(FRONTEND, "tailwind.config.ts"));

  it("keeps darkMode class and every token color mapping", () => {
    expect(TW).toMatch(/darkMode:\s*"class"/);
    for (const name of ["border", "background", "foreground", "muted", "primary", "destructive", "card", "popover", "success", "danger", "warning", "info"]) {
      expect(TW).toContain(`--${name}`);
    }
  });

  it("maps ring to the primary token", () => {
    expect(TW).toMatch(/ring:\s*"hsl\(var\(--primary\)\)"/);
  });

  it("derives radii from --radius (10/8/6 px)", () => {
    expect(TW).toMatch(/lg:\s*"var\(--radius\)"/);
    expect(TW).toMatch(/md:\s*"calc\(var\(--radius\) - 2px\)"/);
    expect(TW).toMatch(/sm:\s*"calc\(var\(--radius\) - 4px\)"/);
  });

  it("uses Inter for sans and serif, JetBrains Mono for mono, with a serif ban comment", () => {
    expect(TW).toMatch(/sans:\s*\["Inter",\s*"system-ui",\s*"sans-serif"\]/);
    expect(TW).toMatch(/serif:\s*\["Inter",\s*"system-ui",\s*"sans-serif"\]/);
    expect(TW).toMatch(/mono:\s*\["JetBrains Mono",\s*"ui-monospace",\s*"monospace"\]/);
    expect(TW).toMatch(/serif is banned/i);
    expect(TW).not.toMatch(/Georgia|Times/);
  });
});

describe("T03 boot background", () => {
  const HTML = read(path.join(FRONTEND, "index.html"));
  const BOOT = read(path.join(FRONTEND, "public/theme-boot.js"));

  it("index.html paints the light and dark backgrounds before React", () => {
    expect(HTML).toMatch(/html\s*\{\s*background-color:\s*hsl\(220 20% 98%\);?\s*\}/);
    expect(HTML).toMatch(/html\.dark\s*\{\s*background-color:\s*hsl\(222 24% 7%\);?\s*\}/);
  });

  it("theme-boot.js keeps its logic and hard-codes no colors", () => {
    expect(BOOT).toContain('"qa-theme"');
    expect(BOOT).toContain('classList.toggle("dark"');
    expect(BOOT).not.toMatch(/#[0-9a-f]{3,8}\b|hsl\(|rgb\(/i);
  });
});

// ── brand mark ───────────────────────────────────────────────────────

function svgOf(file: string): Document {
  return new DOMParser().parseFromString(read(file), "image/svg+xml");
}
const pathsOf = (doc: Document | Element) => Array.from(doc.querySelectorAll("path")).map((p) => p.getAttribute("d")!.trim());
const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe("T03 BrandMark component", () => {
  it("renders a 32x32 rounded square filled with the primary token", () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 32 32");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    const rect = svg.querySelector("rect")!;
    expect(rect.getAttribute("rx")).toBe("8");
    expect(rect.getAttribute("width")).toBe("32");
    expect(rect.getAttribute("height")).toBe("32");
    expect(rect.getAttribute("fill")).toBe("hsl(var(--primary))");
  });

  it("draws white round-capped strokes of width 3, no gradient, no glow", () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector("svg")!;
    const paths = Array.from(svg.querySelectorAll("path"));
    expect(paths.length).toBeGreaterThanOrEqual(1);
    for (const p of paths) {
      expect(p.getAttribute("stroke")?.toLowerCase()).toMatch(/^#(fff|ffffff)$|^white$/);
      expect(p.getAttribute("stroke-width")).toBe("3");
      expect(p.getAttribute("stroke-linecap")).toBe("round");
    }
    expect(svg.querySelector("linearGradient, radialGradient, filter, feGaussianBlur")).toBeNull();
    expect(svg.outerHTML).not.toMatch(/url\(#/);
  });

  it("is a V whose right arm keeps rising up and to the right", () => {
    const { container } = render(<BrandMark />);
    const pts: number[][] = [];
    for (const d of pathsOf(container)) {
      const n = nums(d);
      for (let i = 0; i < n.length; i += 2) pts.push([n[i], n[i + 1]]);
    }
    // Lowest point (max y) is the V's vertex; it is not at either end of the x range.
    const vertex = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
    const xs = pts.map((p) => p[0]);
    expect(vertex[0]).toBeGreaterThan(Math.min(...xs));
    expect(vertex[0]).toBeLessThan(Math.max(...xs));
    // Rightmost point is above (smaller y) the leftmost point: uptrend.
    const left = pts.reduce((a, b) => (b[0] < a[0] ? b : a));
    const right = pts.reduce((a, b) => (b[0] > a[0] ? b : a));
    expect(right[1]).toBeLessThan(left[1]);
    // All points inside the 32 box.
    for (const [x, y] of pts) { expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(32); expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(32); }
  });

  it("applies className and has a default size", () => {
    expect(render(<BrandMark className="h-10 w-10 foo" />).container.querySelector("svg")!.getAttribute("class")).toBe("h-10 w-10 foo");
    expect(render(<BrandMark />).container.querySelector("svg")!.getAttribute("class")).toMatch(/h-\d+ w-\d+/);
  });
});

describe("T03 static brand artwork", () => {
  const brandPaths = pathsOf(render(<BrandMark />).container);

  it.each([["public/favicon.svg"], ["public/logo.svg"]])("%s matches BrandMark with a fixed #1555E0 fill", (rel) => {
    const doc = svgOf(path.join(FRONTEND, rel));
    const svg = doc.documentElement;
    expect(svg.getAttribute("viewBox")).toBe("0 0 32 32");
    const rect = svg.querySelector("rect")!;
    expect(rect.getAttribute("rx")).toBe("8");
    expect(rect.getAttribute("fill")!.toUpperCase()).toBe("#1555E0");
    expect(pathsOf(doc).map(nums)).toEqual(brandPaths.map(nums));
    expect(svg.querySelector("linearGradient, radialGradient, filter")).toBeNull();
    expect(read(path.join(FRONTEND, rel))).not.toMatch(/var\(--/);
  });

  it("assets/icon.svg is the same artwork scaled x32 to 1024 with rx 224", () => {
    const doc = svgOf(path.join(REPO, "assets/icon.svg"));
    const svg = doc.documentElement;
    expect(svg.getAttribute("viewBox")).toBe("0 0 1024 1024");
    const rect = svg.querySelector("rect")!;
    expect(rect.getAttribute("rx")).toBe("224");
    expect(rect.getAttribute("width")).toBe("1024");
    expect(rect.getAttribute("fill")!.toUpperCase()).toBe("#1555E0");
    expect(pathsOf(doc).map(nums)).toEqual(brandPaths.map((d) => nums(d).map((n) => n * 32)));
    for (const p of Array.from(svg.querySelectorAll("path"))) expect(p.getAttribute("stroke-width")).toBe("96");
    expect(svg.querySelector("linearGradient, radialGradient, filter")).toBeNull();
  });
});

// ── icon.png ─────────────────────────────────────────────────────────

/** Minimal PNG decoder for 8-bit RGB/RGBA non-interlaced images. */
function decodePng(buf: Buffer) {
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  let off = 8; let width = 0; let height = 0; let colorType = 0; let bitDepth = 0; let interlace = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    if (type === "IDAT") idat.push(data);
    if (type === "IEND") break;
    off += 12 + len;
  }
  return { width, height, bitDepth, colorType, interlace, raw: idat.length ? zlib.inflateSync(Buffer.concat(idat)) : Buffer.alloc(0) };
}

function pixelAt(png: ReturnType<typeof decodePng>, x: number, y: number): number[] {
  const bpp = png.colorType === 6 ? 4 : 3;
  const stride = png.width * bpp;
  const out = Buffer.alloc(png.height * stride);
  for (let r = 0; r <= y; r++) {
    const f = png.raw[r * (stride + 1)];
    const line = png.raw.subarray(r * (stride + 1) + 1, (r + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[r * stride + i - bpp] : 0;
      const b = r > 0 ? out[(r - 1) * stride + i] : 0;
      const c = r > 0 && i >= bpp ? out[(r - 1) * stride + i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[r * stride + i] = v & 0xff;
    }
  }
  return Array.from(out.subarray(y * stride + x * bpp, y * stride + x * bpp + bpp));
}

describe("T03 assets/icon.png", () => {
  const png = decodePng(fs.readFileSync(path.join(REPO, "assets/icon.png")));

  it("is a 1024x1024 8-bit non-interlaced PNG", () => {
    expect([png.width, png.height, png.bitDepth, png.interlace]).toEqual([1024, 1024, 8, 0]);
    expect([2, 6]).toContain(png.colorType);
  });

  it("was rasterized from the new artwork: #1555E0 body, white stroke, transparent corner", () => {
    const [r, g, b] = pixelAt(png, 512, 120); // inside the square, above the strokes
    expect(Math.abs(r - 0x15)).toBeLessThanOrEqual(3);
    expect(Math.abs(g - 0x55)).toBeLessThanOrEqual(3);
    expect(Math.abs(b - 0xe0)).toBeLessThanOrEqual(3);
    // The V vertex (416, 736) is on the white stroke.
    expect(pixelAt(png, 416, 720).slice(0, 3).every((c) => c >= 245)).toBe(true);
    if (png.colorType === 6) expect(pixelAt(png, 2, 2)[3]).toBeLessThan(10); // rounded corner (rx 224)
  });
});

// ── slop sweep over T03-owned files ──────────────────────────────────

const OWNED = [
  "src/components/ui", "src/components/layout/TopBar.tsx", "src/components/layout/AssistantDock.tsx",
  "src/components/layout/SidebarNavigation.tsx", "src/components/layout/Layout.tsx", "src/components/layout/navigation.ts",
  "src/components/claude/ChatPanel.tsx", "src/components/terminal/TerminalPanel.tsx", "src/components/wallet/WalletButton.tsx",
  "src/components/common/BrandMark.tsx", "src/components/common/Skeleton.tsx", "src/pages/Home.tsx",
];
function ownedFiles(): string[] {
  const out: string[] = [];
  for (const rel of OWNED) {
    const p = path.join(FRONTEND, rel);
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p)) if (/\.tsx?$/.test(f)) out.push(path.join(p, f));
    } else out.push(p);
  }
  return out;
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("T03 slop ban sweep", () => {
  const files = ownedFiles().map((f) => [path.relative(FRONTEND, f), stripComments(read(f))] as const);

  it("covers the expected files", () => {
    expect(files.length).toBeGreaterThanOrEqual(OWNED.length + 12);
  });

  it.each([
    ["em dash", /—/],
    ["uppercase class", /\buppercase\b/],
    ["wide tracking", /tracking-(wide|wider|widest)\b|tracking-\[0?\.\d+em\]/],
    ["serif font", /font-serif|Georgia/],
    ["gradient", /gradient|bg-gradient/],
    ["purple / violet / fuchsia", /\b(purple|violet|fuchsia)-\d{2,3}\b/],
    ["glow / blur blob", /blur-(2xl|3xl)|shadow-\[0_0_|drop-shadow-\[0_0/],
    ["bounce / ping animation", /animate-(bounce|ping)\b/],
    ["beige / amber-50 / stone paper tones", /\b(amber|stone|orange)-(50|100)\b|#f5f0e|#faf7f/i],
    ["emoji", /\p{Extended_Pictographic}/u],
  ])("no %s in T03 files", (_label, re) => {
    const hits = files.filter(([, src]) => re.test(src)).map(([f]) => f);
    expect(hits).toEqual([]);
  });

  it("no 01 / 02 / 03 counters in Home.tsx", () => {
    const home = files.find(([f]) => f.endsWith("Home.tsx"))![1];
    expect(home).not.toMatch(/["'>]\s*0[1-9]\s*["'<]/);
    expect(home).not.toMatch(/<ol\b|list-decimal|index \+ 1|i \+ 1/);
  });
});
