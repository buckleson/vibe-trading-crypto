import { useRef } from "react";
import i18n from "@/i18n";
import { getChartTheme } from "@/lib/chart-theme";
import { escapeHtml } from "@/lib/escapeHtml";
import { useChartLifecycle } from "@/hooks/useChartLifecycle";
import { contrastText, mixRgb, rgbCss, tokenRgb, type RGB } from "./chartTokens";

interface Props {
  labels: string[];
  matrix: (number | null)[][];
  height?: number;
}

/** Diverging scale: danger hue at -1, muted neutral at 0, primary hue at +1. */
function divergingStops(): RGB[] {
  return [
    tokenRgb("--danger", [197, 32, 32]),
    tokenRgb("--muted", [237, 239, 242]),
    tokenRgb("--primary", [21, 85, 224]),
  ];
}

function cellRgb(value: number, stops: RGB[]): RGB {
  const v = Math.min(1, Math.max(-1, value));
  return v < 0 ? mixRgb(stops[1], stops[0], -v) : mixRgb(stops[1], stops[2], v);
}

export function CorrelationMatrix({ labels, matrix, height = 500 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useChartLifecycle(ref, () => {
    const t = getChartTheme();
    const stops = divergingStops();

    // Build heatmap data: [xIdx, yIdx, value] with per-cell label color for readability on saturated cells.
    // Undefined pairs (null - zero-variance leg such as a halted series) are missing
    // evidence, not 0.0: render them as a muted "-" cell instead of cooling the
    // heatmap with a fabricated "no linear relationship" reading.
    const data: { value: [number, number, number]; label: { color: string }; itemStyle?: { color: string; opacity: number } }[] = [];
    for (let i = 0; i < labels.length; i++) {
      for (let j = 0; j < labels.length; j++) {
        const raw = matrix[i]?.[j] ?? null;
        if (raw === null) {
          data.push({ value: [j, i, 0], label: { color: t.textColor }, itemStyle: { color: t.gridColor, opacity: 0.6 } });
          continue;
        }
        const val = parseFloat(raw.toFixed(4));
        data.push({ value: [j, i, val], label: { color: contrastText(cellRgb(val, stops)) } });
      }
    }

    const minVal = -1;
    const maxVal = 1;

    return {
      backgroundColor: "transparent",
      tooltip: {
        position: "top",
        backgroundColor: t.tooltipBg,
        borderColor: t.tooltipBorder,
        borderWidth: 1,
        extraCssText: "box-shadow:none;",
        textStyle: { color: t.tooltipText, fontSize: 12 },
        formatter: (params: unknown) => {
          const p = params as { data: { value: [number, number, number] } };
          const [x, y, v] = p.data.value;
          const rawCell = matrix[y]?.[x] ?? null;
          const rText = rawCell === null ? i18n.t("charts.correlationUndefined") : v.toFixed(4);
          return `<b>${escapeHtml(labels[x] ?? "")}</b> vs <b>${escapeHtml(labels[y] ?? "")}</b><br/>r = <b>${escapeHtml(rText)}</b>`;
        },
      },
      grid: { left: "3%", right: "8%", top: "8%", bottom: "12%", containLabel: true },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: {
          color: t.textColor,
          fontSize: 12,
          rotate: 30,
          interval: 0,
        },
        axisLine: { lineStyle: { color: t.axisColor } },
        splitArea: { show: false },
      },
      yAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: t.textColor, fontSize: 12, interval: 0 },
        axisLine: { lineStyle: { color: t.axisColor } },
        splitArea: { show: false },
      },
      visualMap: {
        min: minVal,
        max: maxVal,
        precision: 2,
        calculable: true,
        orient: "vertical",
        right: 8,
        top: "center",
        textStyle: { color: t.textColor, fontSize: 12 },
        inRange: {
          color: stops.map((c) => rgbCss(c)),
        },
      },
      series: [
        {
          name: "Correlation",
          type: "heatmap",
          data,
          label: {
            show: labels.length <= 8,
            fontSize: 12,
            formatter: (params: unknown) => {
              const p = params as { value: [number, number, number] };
              const [x, y] = p.value;
              const rawCell = matrix[y]?.[x] ?? null;
              return rawCell === null ? "-" : p.value[2].toFixed(2);
            },
          },
          emphasis: {
            itemStyle: { borderColor: t.textColor, borderWidth: 1 },
          },
        },
      ],
    };
  }, [labels, matrix]);

  if (labels.length === 0 || matrix.length === 0) {
    return <div className="text-muted-foreground text-sm p-4">{i18n.t("charts.noCorrelationData")}</div>;
  }
  return <div ref={ref} style={{ height }} />;
}
