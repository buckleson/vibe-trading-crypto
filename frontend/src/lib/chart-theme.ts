function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function hslToHex(hsl: string): string {
  if (!hsl) return "";
  const [h, s, l] = hsl.split(/\s+/).map(parseFloat);
  if (isNaN(h)) return "";
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function isChinese(): boolean {
  return (document.documentElement.lang || navigator.language || "").startsWith("zh");
}

export const SERIES_LIGHT = ["#1555E0", "#B36205", "#0F8A7E", "#C2417A", "#5C6370", "#7A8F0E"];
export const SERIES_DARK = ["#5090F7", "#F6AA28", "#2CC5B4", "#E879A8", "#98A0AE", "#B5CC3A"];

let _cache: ReturnType<typeof buildTheme> | null = null;
let _cacheKey = "";

function buildTheme() {
  const cn = isChinese();
  const isDark = document.documentElement.classList.contains("dark");

  const successHex = hslToHex(css("--success")) || (isDark ? "#39C684" : "#1D7C50");
  const dangerHex = hslToHex(css("--danger")) || (isDark ? "#EE6363" : "#C52020");
  const infoHex = hslToHex(css("--info")) || (isDark ? "#3EBAF4" : "#0A73A4");
  const warningHex = hslToHex(css("--warning")) || (isDark ? "#F6AA28" : "#A95C04");
  const gridHex = hslToHex(css("--chart-grid")) || (isDark ? "#22262F" : "#EDEFF2");
  const textHex = hslToHex(css("--chart-text")) || (isDark ? "#98A0AE" : "#5C6370");
  const axisHex = hslToHex(css("--chart-axis")) || (isDark ? "#303540" : "#DCDFE5");

  const series = isDark ? SERIES_DARK : SERIES_LIGHT;

  // Locale-aware candlestick colors: China = red up / green down
  const upHex = cn ? dangerHex : successHex;
  const downHex = cn ? successHex : dangerHex;

  return {
    gridColor: gridHex,
    textColor: textHex,
    axisColor: axisHex,
    upColor: upHex,
    downColor: downHex,
    maColors: [warningHex, series[3], infoHex],
    bollColor: series[0] + "80",
    seriesPalette: series,
    volumeUp: upHex + "66",
    volumeDown: downHex + "66",
    infoColor: infoHex,
    warningColor: warningHex,
    tooltipBg: isDark ? "rgba(27,30,40,0.96)" : "rgba(255,255,255,0.96)",
    tooltipBorder: isDark ? "#303540" : "#DCDFE5",
    tooltipText: isDark ? "#EDEFF3" : "#121621",
  };
}

export function getChartTheme() {
  const key = `${document.documentElement.className}|${document.documentElement.lang || navigator.language}`;
  if (_cache && _cacheKey === key) return _cache;
  _cache = buildTheme();
  _cacheKey = key;
  return _cache;
}
