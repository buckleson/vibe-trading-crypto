// T13: locale sync. Every literal t() key with a defaultValue lives in en.json
// with the same English text, all 11 locales share one key set, auth/API-key
// orphans are gone, and no em dash or "Vibe-Trading" remains in any value.
//
// Offline and deterministic: reads source and locale files from disk only.
import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import i18n, { SUPPORTED_LANGUAGES } from "@/i18n";
import { NAVIGATION_GROUPS, SETTINGS_ITEM, pageTitleKey } from "@/components/layout/navigation";

// ── paths ──────────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../..");
const LOCALES_DIR = path.join(SRC, "i18n/locales");

type Tree = Record<string, unknown>;

const LOCALE_CODES = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith(".json") && f !== "tsconfig.json")
  .map((f) => f.slice(0, -".json".length))
  .sort();

const RAW: Record<string, string> = Object.fromEntries(
  LOCALE_CODES.map((c) => [c, fs.readFileSync(path.join(LOCALES_DIR, `${c}.json`), "utf8")]),
);
const LOCALES: Record<string, Tree> = Object.fromEntries(
  LOCALE_CODES.map((c) => [c, JSON.parse(RAW[c]) as Tree]),
);
const EN = LOCALES.en;
const NON_EN = LOCALE_CODES.filter((c) => c !== "en");

// ── helpers ────────────────────────────────────────────────────

function flatten(obj: Tree, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flatten(v as Tree, full));
    else out[full] = v;
  }
  return out;
}

function getLeaf(obj: Tree, dotted: string): unknown {
  let cur: unknown = obj;
  for (const part of dotted.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = (cur as Tree)[part];
  }
  return cur;
}

const FLAT: Record<string, Record<string, unknown>> = Object.fromEntries(
  LOCALE_CODES.map((c) => [c, flatten(LOCALES[c])]),
);
const EN_FLAT = FLAT.en as Record<string, string>;

function vars(s: string): string[] {
  return [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
}

function walkSources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "i18n" || e.name === "tests" || e.name === "node_modules") continue;
      walkSources(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.|\.d\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

// ── extractor (mirror of the T13 step-1 script, done with the TS AST) ──

interface Found {
  key: string;
  defaultValue: string;
  loc: string;
}
interface Extraction {
  literal: Found[];
  dynamic: { expr: string; loc: string }[];
}

/** Template `${x}` becomes i18next `{{x}}` so a JS template defaultValue compares to the locale text. */
function templateToI18n(node: ts.TemplateExpression): string {
  let s = node.head.text;
  for (const span of node.templateSpans) s += `{{${span.expression.getText()}}}` + span.literal.text;
  return s;
}

export function extract(fileName: string, code: string): Extraction {
  const sf = ts.createSourceFile(
    fileName, code, ts.ScriptTarget.Latest, true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const literal: Found[] = [];
  const dynamic: { expr: string; loc: string }[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.arguments.length > 0) {
      const c = n.expression;
      const isT = (ts.isIdentifier(c) && c.text === "t")
        || (ts.isPropertyAccessExpression(c) && c.name.text === "t");
      if (isT) {
        const loc = `${fileName}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
        const a = n.arguments[0];
        const isLit = ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a);
        if (!isLit) {
          dynamic.push({ expr: a.getText(), loc });
        } else {
          const opt = n.arguments[1];
          if (opt && ts.isObjectLiteralExpression(opt)) {
            for (const p of opt.properties) {
              if (!ts.isPropertyAssignment(p)) continue;
              const name = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : "";
              if (name !== "defaultValue") continue;
              const v = p.initializer;
              if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) {
                literal.push({ key: a.text, defaultValue: v.text, loc });
              } else if (ts.isTemplateExpression(v)) {
                literal.push({ key: a.text, defaultValue: templateToI18n(v), loc });
              }
            }
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { literal, dynamic };
}

const SOURCE_FILES = walkSources(SRC);
const SOURCES: Record<string, string> = Object.fromEntries(
  SOURCE_FILES.map((f) => [path.relative(SRC, f), fs.readFileSync(f, "utf8")]),
);
const ALL_SOURCE = Object.values(SOURCES).join("\n");
const FOUND: Found[] = Object.entries(SOURCES).flatMap(([f, code]) => extract(f, code).literal);
const DEFAULT_KEYS = [...new Set(FOUND.map((f) => f.key))].sort();

// ── 0. the extractor itself ────────────────────────────────────

describe("T13 extractor (edge cases)", () => {
  it("reads single, double and plain template quotes", () => {
    const { literal } = extract("a.tsx", `
      t('a.single', { defaultValue: 'One' });
      t("a.double", { defaultValue: "Two" });
      t(\`a.tpl\`, { defaultValue: \`Three\` });
    `);
    expect(literal.map((l) => [l.key, l.defaultValue])).toEqual([
      ["a.single", "One"], ["a.double", "Two"], ["a.tpl", "Three"],
    ]);
  });

  it("handles multi-line calls and defaultValue before or after other options", () => {
    const { literal } = extract("b.ts", `
      t(
        "b.after",
        {
          count: n,
          defaultValue: "{{count}} runs",
        },
      );
      i18n.t("b.before", { defaultValue: "Hi {{name}}", name });
    `);
    expect(literal).toEqual([
      expect.objectContaining({ key: "b.after", defaultValue: "{{count}} runs" }),
      expect.objectContaining({ key: "b.before", defaultValue: "Hi {{name}}" }),
    ]);
  });

  it("maps a JS template defaultValue to i18next placeholders", () => {
    const { literal } = extract("c.ts", "t('c.k', { defaultValue: `Open (${shortcut})` });");
    expect(literal[0].defaultValue).toBe("Open ({{shortcut}})");
  });

  it("reports template-expression keys as dynamic and ignores calls without defaultValue", () => {
    const { literal, dynamic } = extract("d.ts", `
      t(\`layout.\${id}\`);
      t("plain.key");
      t("x.y", { count: 2 });
      t(key, { defaultValue: "ignored because the key is dynamic" });
    `);
    expect(literal).toEqual([]);
    expect(dynamic.map((d) => d.expr)).toEqual(["`layout.${id}`", "key"]);
  });

  it("ignores functions that merely end in t (format, split) and empty input", () => {
    expect(extract("e.ts", "format('a', { defaultValue: 'x' }); split('b');").literal).toEqual([]);
    expect(extract("f.ts", "").literal).toEqual([]);
  });

  it("finds a non-trivial number of defaultValue keys in the real source tree", () => {
    // T13 added 151 keys; the tree must still be dominated by them.
    expect(DEFAULT_KEYS.length).toBeGreaterThanOrEqual(100);
  });
});

// ── 1-2. every literal defaultValue key exists in en.json ──────

describe("T13 defaultValue keys are in en.json", () => {
  it("every literal key resolves to a string leaf in en.json", () => {
    const missing = FOUND.filter((f) => typeof getLeaf(EN, f.key) !== "string").map((f) => `${f.key} @ ${f.loc}`);
    expect(missing).toEqual([]);
  });

  it("en.json holds the same English text as the component defaultValue", () => {
    const differs = FOUND
      .filter((f) => typeof getLeaf(EN, f.key) === "string" && getLeaf(EN, f.key) !== f.defaultValue)
      .map((f) => `${f.key} @ ${f.loc}: component="${f.defaultValue}" en="${String(getLeaf(EN, f.key))}"`);
    expect(differs).toEqual([]);
  });

  it("no key is used with two different defaultValues across the source", () => {
    const byKey = new Map<string, Set<string>>();
    for (const f of FOUND) (byKey.get(f.key) ?? byKey.set(f.key, new Set()).get(f.key)!).add(f.defaultValue);
    const conflicting = [...byKey].filter(([, s]) => s.size > 1).map(([k, s]) => `${k}: ${[...s].join(" | ")}`);
    expect(conflicting).toEqual([]);
  });

  it("no defaultValue key is both a leaf and a branch (path collision)", () => {
    const leaves = new Set(Object.keys(EN_FLAT));
    const collisions = DEFAULT_KEYS.filter((k) => [...leaves].some((l) => l.startsWith(`${k}.`)));
    expect(collisions).toEqual([]);
  });

  it("dynamic SUGGESTIONS keys in the Claude chat panel exist with the same text", () => {
    const code = SOURCES[path.join("components", "claude", "ChatPanel.tsx")];
    expect(code).toBeDefined();
    const pairs = [...code.matchAll(/\[\s*"(claude\.\w+)"\s*,\s*"([^"]+)"\s*\]/g)].map((m) => [m[1], m[2]]);
    expect(pairs.length).toBeGreaterThanOrEqual(3);
    for (const [key, text] of pairs) expect(getLeaf(EN, key)).toBe(text);
  });
});

// ── dynamic key families from navigation.ts ────────────────────

describe("T13 dynamic key families", () => {
  const groupIds = NAVIGATION_GROUPS.map((g) => g.id);
  const itemIds = [...NAVIGATION_GROUPS.flatMap((g) => g.items.map((i) => i.id)), SETTINGS_ITEM.id];

  it("the navigation includes the new trade group", () => {
    expect(groupIds).toContain("trade");
  });

  it.each(LOCALE_CODES)("%s has navigation.groups.<id> for every group", (code) => {
    const missing = groupIds.filter((id) => typeof getLeaf(LOCALES[code], `navigation.groups.${id}`) !== "string");
    expect(missing).toEqual([]);
  });

  it.each(LOCALE_CODES)("%s has layout.<id> and navigation.descriptions.<id> for every item", (code) => {
    const missing = itemIds.flatMap((id) => [`layout.${id}`, `navigation.descriptions.${id}`])
      .filter((k) => typeof getLeaf(LOCALES[code], k) !== "string" || getLeaf(LOCALES[code], k) === "");
    expect(missing).toEqual([]);
  });

  it.each(LOCALE_CODES)("%s has navigation.instructions.<id> for every item that shows page help", (code) => {
    // PageHelp renders nothing for the agent page.
    const missing = itemIds.filter((id) => id !== "agent")
      .filter((id) => typeof getLeaf(LOCALES[code], `navigation.instructions.${id}`) !== "string");
    expect(missing).toEqual([]);
  });

  it("en navigation.groups.trade matches the sidebar fallback text", () => {
    expect(getLeaf(EN, "navigation.groups.trade")).toBe("Trade");
  });

  it.each([
    ["/runs/abc", "layout.run"],
    ["/compare", "layout.compare"],
    ["/compare/a/b", "layout.compare"],
    ["/about", "layout.about"],
    ["/no-such-page", "layout.app"],
  ])("pageTitleKey(%s) resolves to %s whose en text equals the fallback", (pathname, key) => {
    const { key: k, fallback } = pageTitleKey(pathname);
    expect(k).toBe(key);
    expect(getLeaf(EN, k)).toBe(fallback);
    for (const code of NON_EN) expect(typeof getLeaf(LOCALES[code], k)).toBe("string");
  });

  it("pageTitleKey for a navigation item resolves to an existing layout key", () => {
    for (const id of itemIds) {
      const item = [...NAVIGATION_GROUPS.flatMap((g) => [...g.items]), SETTINGS_ITEM].find((i) => i.id === id)!;
      const { key } = pageTitleKey(item.to);
      expect(typeof getLeaf(EN, key)).toBe("string");
    }
  });
});

// ── 3. parity and translations ─────────────────────────────────

describe("T13 locale parity", () => {
  it("there are exactly the 11 supported locales on disk", () => {
    expect(LOCALE_CODES).toEqual(SUPPORTED_LANGUAGES.map((l) => l.code).sort());
    expect(LOCALE_CODES).toHaveLength(11);
  });

  it.each(NON_EN)("%s has the identical key set (both directions)", (code) => {
    const enKeys = Object.keys(EN_FLAT).sort();
    const locKeys = Object.keys(FLAT[code]).sort();
    expect(locKeys.filter((k) => !(k in EN_FLAT))).toEqual([]);
    expect(enKeys.filter((k) => !(k in FLAT[code]))).toEqual([]);
  });

  it.each(LOCALE_CODES)("%s has only non-empty string leaves (no arrays, numbers, null)", (code) => {
    const bad = Object.entries(FLAT[code])
      .filter(([, v]) => typeof v !== "string" || v.trim() === "").map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it.each(NON_EN)("%s keeps placeholders identical for every defaultValue key", (code) => {
    const bad = DEFAULT_KEYS.filter((k) => {
      const e = getLeaf(EN, k), l = getLeaf(LOCALES[code], k);
      return typeof e === "string" && typeof l === "string" && vars(e).join() !== vars(l).join();
    });
    expect(bad).toEqual([]);
  });

  it.each(LOCALE_CODES)("%s has balanced {{ }} in every value", (code) => {
    const bad = Object.entries(FLAT[code]).filter(([, v]) => {
      const s = String(v);
      return (s.match(/\{\{/g) ?? []).length !== (s.match(/\}\}/g) ?? []).length;
    }).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  // Non-Latin scripts: every new key must differ from English except product names.
  const PRODUCT_ONLY = new Set(["Claude", "Vibe Crypto", "Claude Code", "MetaMask", "MCP"]);
  it.each(["zh-CN", "ja", "ko", "ar", "fa"])("%s translates every defaultValue key (non-Latin script)", (code) => {
    const copied = DEFAULT_KEYS.filter((k) => {
      const e = getLeaf(EN, k);
      return getLeaf(LOCALES[code], k) === e && !PRODUCT_ONLY.has(String(e));
    });
    expect(copied).toEqual([]);
  });

  it.each(["zh-CN", "ja", "ko", "ar", "fa"])("%s new-key values contain characters of the locale script", (code) => {
    const script: Record<string, RegExp> = {
      "zh-CN": /[一-鿿]/, ja: /[぀-ヿ一-鿿]/, ko: /[가-힯]/,
      ar: /[؀-ۿ]/, fa: /[؀-ۿ]/,
    };
    const latinOnly = DEFAULT_KEYS.filter((k) => {
      const v = String(getLeaf(LOCALES[code], k));
      return !PRODUCT_ONLY.has(v) && !script[code].test(v);
    });
    // A few values are command snippets or symbols; nearly all must be in script.
    expect(latinOnly.length).toBeLessThanOrEqual(Math.ceil(DEFAULT_KEYS.length * 0.05));
  });

  // Latin scripts: short words (Chat, Terminal, Sharpe) may legitimately match;
  // any sentence of four words or more must be translated.
  it.each(["es", "de", "pt-BR", "id", "tr"])("%s translates every multi-word new string", (code) => {
    const copied = DEFAULT_KEYS.filter((k) => {
      const e = String(getLeaf(EN, k));
      return e.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length >= 4 && getLeaf(LOCALES[code], k) === e;
    });
    expect(copied).toEqual([]);
  });

  it("Turkish copies no new English text except shared product terms", () => {
    const shared = new Set(["Claude", "Vibe Crypto", "Terminal"]);
    const copied = DEFAULT_KEYS.filter((k) => {
      const e = String(getLeaf(EN, k));
      return getLeaf(LOCALES.tr, k) === e && !shared.has(e);
    });
    expect(copied).toEqual([]);
  });

  it("Turkish new strings use Turkish letters somewhere (real Turkish, not ASCII English)", () => {
    const withTurkish = DEFAULT_KEYS.filter((k) => /[çğıöşüÇĞİÖŞÜ]/.test(String(getLeaf(LOCALES.tr, k))));
    expect(withTurkish.length).toBeGreaterThan(DEFAULT_KEYS.length / 3);
  });

  it.each(NON_EN)("%s keeps product names and commands verbatim where English has them", (code) => {
    const tokens = ["Claude Code", "MetaMask", "MCP", "Vibe Crypto", "ANTHROPIC_API_KEY", "vibe-crypto mcp install", "claude mcp add"];
    const lost: string[] = [];
    for (const k of DEFAULT_KEYS) {
      const e = String(getLeaf(EN, k)), l = String(getLeaf(LOCALES[code], k));
      // German compounds hyphenate a product name ("Vibe-Crypto-Tools"); that still keeps it untranslated.
      for (const tok of tokens) if (e.includes(tok) && !l.includes(tok) && !(code === "de" && l.includes(tok.replace(/ /g, "-")))) lost.push(`${k}: ${tok}`);
      for (const url of e.match(/https?:\/\/\S+/g) ?? []) if (!l.includes(url.replace(/[.,)]+$/, ""))) lost.push(`${k}: ${url}`);
    }
    expect(lost).toEqual([]);
  });

  it.each(LOCALE_CODES)("%s has no mojibake", (code) => {
    const bad = Object.entries(FLAT[code]).filter(([, v]) => /â€|Ã[\u0080-¿]|Â |�/.test(String(v))).map(([k]) => k);
    expect(bad).toEqual([]);
  });
});

// ── 4. orphans removed ─────────────────────────────────────────

const REMOVED = [
  "settings.authRequired", "settings.authDesc", "settings.apiAuthKey", "settings.localApiAccess",
  "settings.localApiAccessDesc", "settings.serverApiKey", "settings.storedInBrowser", "settings.localApiKeySaved",
  "runDashboard.eyebrow", "alphaZoo.benchRunner", "alphaZoo.headToHeadCompare", "paper.description",
];

describe("T13 orphans", () => {
  it.each(LOCALE_CODES)("%s no longer contains the removed auth and orphan keys", (code) => {
    const still = REMOVED.filter((k) => getLeaf(LOCALES[code], k) !== undefined);
    expect(still).toEqual([]);
  });

  it.each(LOCALE_CODES)("%s no longer has the old home.* namespace", (code) => {
    expect(LOCALES[code].home).toBeUndefined();
  });

  it.each(LOCALE_CODES)("%s has no settings key named for local API auth", (code) => {
    const settings = (LOCALES[code].settings ?? {}) as Tree;
    const bad = Object.keys(flatten(settings)).filter((k) => /apiAuth|authKey|localApi|sseTicket|authRequired|authDesc/i.test(k));
    expect(bad).toEqual([]);
  });

  it("removed keys have zero references in frontend/src (grep proof)", () => {
    const referenced = REMOVED.filter((k) => ALL_SOURCE.includes(`"${k}"`) || ALL_SOURCE.includes(`'${k}'`) || ALL_SOURCE.includes(`\`${k}\``));
    expect(referenced).toEqual([]);
    // The old home page family must not be built dynamically either.
    expect(ALL_SOURCE).not.toMatch(/["'`]home\.[\w$]/);
  });

  it("agent.authRequired is kept in every locale while lib/api.ts still reads it", () => {
    if (ALL_SOURCE.includes("agent.authRequired")) {
      for (const code of LOCALE_CODES) expect(typeof getLeaf(LOCALES[code], "agent.authRequired")).toBe("string");
    }
  });
});

// ── component key renames ──────────────────────────────────────

describe("T13 component key renames", () => {
  const detail = SOURCES[path.join("components", "paper", "PaperRunDetail.tsx")];
  const page = SOURCES[path.join("pages", "PaperTrading.tsx")];

  it("PaperRunDetail uses paper.colSymbol / paper.colQty, not the colliding manual-account keys", () => {
    expect(detail).toMatch(/["']paper\.colSymbol["']/);
    expect(detail).toMatch(/["']paper\.colQty["']/);
    expect(detail).not.toMatch(/["']paper\.symbol["']/);
    expect(detail).not.toMatch(/["']paper\.quantity["']/);
  });

  it("PaperTrading uses paper.pageDescription instead of paper.description", () => {
    expect(page).toMatch(/["']paper\.pageDescription["']/);
    expect(page).not.toMatch(/["']paper\.description["']/);
  });

  it.each(LOCALE_CODES)("%s has the renamed keys and still has the manual-account paper.symbol / paper.quantity", (code) => {
    for (const k of ["paper.colSymbol", "paper.colQty", "paper.pageDescription", "paper.symbol", "paper.quantity"]) {
      expect(typeof getLeaf(LOCALES[code], k), `${code}:${k}`).toBe("string");
    }
  });

  it("the renamed column keys are distinct text from the manual-account keys in English", () => {
    expect(getLeaf(EN, "paper.colSymbol")).not.toBe(getLeaf(EN, "paper.symbol"));
  });
});

// ── 5. copy cleanup ────────────────────────────────────────────

describe("T13 copy cleanup", () => {
  it.each(LOCALE_CODES)("%s has no em dash in any value", (code) => {
    const bad = Object.entries(FLAT[code]).filter(([, v]) => String(v).includes("—")).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it.each(LOCALE_CODES)("%s has no em dash escaped in the raw file either", (code) => {
    expect(RAW[code]).not.toMatch(/\\u2014/i);
    expect(RAW[code]).not.toContain("―"); // horizontal bar used as a dash
  });

  it.each(LOCALE_CODES)("%s did not substitute the CJK double dash", (code) => {
    // "-- Select --" style ASCII placeholders predate T13 and are not dashes in prose.
    const bad = Object.entries(FLAT[code]).filter(([, v]) => /——/.test(String(v))).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it.each(LOCALE_CODES)("%s has no Vibe-Trading brand outside the backend header name", (code) => {
    // Case-sensitive on purpose: lowercase ~/.vibe-trading/ paths are real backend config paths.
    const bad = Object.entries(FLAT[code])
      .filter(([, v]) => /Vibe[- ]?Trading|VibeTrading/.test(String(v).replace(/X-Vibe-Trading-Auth/g, "")))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("new English labels are not Title Case (proper nouns excepted)", () => {
    const PROPER = /^(Claude|Code|Vibe|Crypto|MetaMask|MCP|P&L|API|ETH|USD|Sharpe|SDK|CLI|Gildata|AI|LLM|PnL|ID|OK|Ctrl\+J|Cmd\+J)$/;
    const titleCase = DEFAULT_KEYS.filter((k) => {
      const words = String(getLeaf(EN, k)).split(/\s+/).filter((w) => /^[A-Za-z(]/.test(w));
      if (words.length < 2 || words.length > 6) return false;
      const rest = words.slice(1).filter((w) => !PROPER.test(w.replace(/[^\w&+]/g, "")));
      return rest.length > 0 && rest.every((w) => /^\(?[A-Z]/.test(w));
    });
    expect(titleCase).toEqual([]);
  });

  it("new English copy uses no slop patterns (monospace caps counters, double hyphen dashes)", () => {
    const bad = DEFAULT_KEYS.filter((k) => {
      const v = String(getLeaf(EN, k));
      return /^0\d[ .:]/.test(v) || / -- /.test(v);
    });
    expect(bad).toEqual([]);
  });
});

// ── 6. formatting ──────────────────────────────────────────────

describe("T13 JSON formatting", () => {
  it.each(LOCALE_CODES)("%s is 2-space JSON with a trailing newline and no BOM", (code) => {
    const raw = RAW[code];
    expect(raw.charCodeAt(0)).not.toBe(0xfeff);
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toBe(`${JSON.stringify(LOCALES[code], null, 2)}\n`);
  });

  it.each(LOCALE_CODES)("%s has no duplicate keys within one object", (code) => {
    // JSON.parse silently keeps the last duplicate; scan the raw text per object depth.
    const dupes: string[] = [];
    const stack: Set<string>[] = [];
    const re = /("(?:[^"\\]|\\.)*")\s*:|[{}]/g;
    let m: RegExpExecArray | null;
    // Strip string values so braces inside them are ignored.
    const text = RAW[code].replace(/:\s*"(?:[^"\\]|\\.)*"/g, ": \"\"");
    while ((m = re.exec(text))) {
      if (m[0] === "{") stack.push(new Set());
      else if (m[0] === "}") stack.pop();
      else {
        const top = stack[stack.length - 1];
        if (top.has(m[1])) dupes.push(m[1]);
        top.add(m[1]);
      }
    }
    expect(dupes).toEqual([]);
  });
});

// ── runtime: the loader serves the translated text ─────────────

describe("T13 runtime resolution", () => {
  afterAll(async () => { await i18n.changeLanguage("en"); });

  it.each(["zh-CN", "ar", "tr"])("%s resolves new paper, settings and Claude keys to the locale text", async (code) => {
    await i18n.changeLanguage(code);
    // Non-English bundles load lazily on languageChanged; wait for the bundle.
    await vi.waitFor(() => expect(i18n.hasResourceBundle(code, "translation")).toBe(true));
    for (const k of ["paper.pageDescription", "claude.suggestRuns", "navigation.groups.trade", "layout.compare"]) {
      const expected = getLeaf(LOCALES[code], k);
      expect(i18n.t(k as never)).toBe(expected);
      expect(i18n.t(k as never)).not.toBe(getLeaf(EN, k));
    }
  });

  it("interpolates the shortcut placeholder in claude.open for every locale", async () => {
    for (const code of LOCALE_CODES) {
      await i18n.changeLanguage(code);
      if (code !== "en") await vi.waitFor(() => expect(i18n.hasResourceBundle(code, "translation")).toBe(true));
      const out = String(i18n.t("claude.open" as never, { shortcut: "Ctrl+J" } as never));
      expect(out, code).toContain("Ctrl+J");
      expect(out, code).not.toContain("{{");
    }
  });

  it("an unknown key falls back to its defaultValue, not to an empty string", async () => {
    await i18n.changeLanguage("tr");
    expect(i18n.t("t13.noSuchKey" as never, { defaultValue: "Fallback" } as never)).toBe("Fallback");
  });
});
