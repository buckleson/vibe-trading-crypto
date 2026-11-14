/**
 * Read a CSS color token ("H S% L%") as RGB for chart builders that need to
 * interpolate or compute contrast. chart-theme.ts only exposes a fixed set of
 * colors (no primary, danger or muted), so charts needing those read them here.
 */
export type RGB = [number, number, number];

function hslToRgb(h: number, s: number, l: number): RGB {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (light - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)));
  };
  return [f(0), f(8), f(4)];
}

export function tokenRgb(name: string, fallback: RGB): RGB {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const [h, s, l] = raw.split(/[\s/]+/).map(parseFloat);
  if ([h, s, l].some((n) => Number.isNaN(n))) return fallback;
  return hslToRgb(h, s, l);
}

export const rgbCss = ([r, g, b]: RGB, alpha = 1) => (alpha === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`);

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
}

export function luminance([r, g, b]: RGB): number {
  const c = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Black or white text, whichever contrasts more with the background. */
export function contrastText(bg: RGB): string {
  return luminance(bg) > 0.179 ? "#111111" : "#ffffff";
}
