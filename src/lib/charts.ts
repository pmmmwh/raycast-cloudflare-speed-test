import { latencyQuantity } from "./format";
import type { BandwidthSample, LatencySamples, LiveTransfer } from "./run-state";
import { percentile, type Summary } from "./stats";

export interface Theme {
  ink: string;
  inkSecondary: string;
  muted: string;
  grid: string;
  download: string;
  upload: string;
}

// Orange and violet echo speed.cloudflare.com and pass colour-blind separation checks in both modes.
// Idle latency stays neutral: it is the baseline the loaded rows are compared against.
export const LIGHT_THEME: Theme = {
  ink: "#0b0b0b",
  inkSecondary: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  download: "#eb6834",
  upload: "#6250d6",
};

export const DARK_THEME: Theme = {
  ink: "#f0efec",
  inkSecondary: "#c3c2b7",
  muted: "#898781",
  grid: "#2c2c2a",
  download: "#d95926",
  upload: "#9085e9",
};

// The width of the Detail markdown pane beside the metadata panel, in points.
export const CHART_WIDTH = 454;
export const PANEL_GAP = 16;
export const PANEL_WIDTH = (CHART_WIDTH - PANEL_GAP) / 2;

const FONT = `font-family="-apple-system, BlinkMacSystemFont, Helvetica, sans-serif"`;
const BANDWIDTH_HEIGHT = 106;
const LATENCY_ROW_HEIGHT = 28;
const LATENCY_CAPTION_HEIGHT = 20;
const POINT_RADIUS = 2;
const LIVE_RADIUS = 3.5;
const DOT_RADIUS = 2.5;
const BOX_HEIGHT = 9;
const WHISKER_IQR = 1.5;
const MIN_POINT_SPACING = 6;

const fixed = (value: number) => value.toFixed(1);

export function niceCeiling(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

function svg(height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${height}" viewBox="0 0 ${CHART_WIDTH} ${height}">${body}</svg>`;
}

function text(
  x: number,
  y: number,
  content: string,
  { size = 10, fill, anchor = "start" }: { size?: number; fill: string; anchor?: "start" | "middle" | "end" },
): string {
  return `<text x="${fixed(x)}" y="${fixed(y)}" ${FONT} font-size="${size}" fill="${fill}" text-anchor="${anchor}" style="font-variant-numeric: tabular-nums">${content}</text>`;
}

const line = (x1: number, x2: number, y1: number, y2: number, stroke: string, extra = "") =>
  `<line x1="${fixed(x1)}" x2="${fixed(x2)}" y1="${fixed(y1)}" y2="${fixed(y2)}" stroke="${stroke}" ${extra}/>`;

type Point = [x: number, y: number];

// Monotone cubic interpolation (as in d3's curveMonotoneX), so the curve never overshoots the samples.
export function monotonePath(points: Point[]): string {
  if (points.length === 0) {
    return "";
  }
  if (points.length === 1) {
    return `M${fixed(points[0][0])},${fixed(points[0][1])}`;
  }
  const slopes = points.slice(1).map(([x, y], i) => (y - points[i][1]) / (x - points[i][0]));
  const tangents = points.map((_, i) => {
    if (i === 0) {
      return slopes[0];
    }
    if (i === points.length - 1) {
      return slopes[slopes.length - 1];
    }
    const [before, after] = [slopes[i - 1], slopes[i]];
    if (before * after <= 0) {
      return 0;
    }
    const [h0, h1] = [points[i][0] - points[i - 1][0], points[i + 1][0] - points[i][0]];
    const weighted = (before * h1 + after * h0) / (h0 + h1);
    return Math.sign(before) * Math.min(Math.abs(before), Math.abs(after), 0.5 * Math.abs(weighted)) * 2;
  });
  let path = `M${fixed(points[0][0])},${fixed(points[0][1])}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const third = (x1 - x0) / 3;
    path += `C${fixed(x0 + third)},${fixed(y0 + third * tangents[i - 1])},${fixed(x1 - third)},${fixed(y1 - third * tangents[i])},${fixed(x1)},${fixed(y1)}`;
  }
  return path;
}

export interface BandwidthChartInput {
  samples: BandwidthSample[];
  summary: Summary;
  live?: LiveTransfer;
}

export function bandwidthChart({ samples, summary, live }: BandwidthChartInput, theme: Theme): string {
  const values = [...samples.map((sample) => sample.bps), ...(live ? [live.bps] : [])];
  const maxMbps = niceCeiling(Math.max(1, ...values.map((bps) => bps / 1e6)));
  const defs: string[] = [];

  const panels = (["download", "upload"] as const).map((direction, index) => {
    const offset = index * (PANEL_WIDTH + PANEL_GAP);
    const color = theme[direction];
    const plot = { left: offset + 26, right: offset + PANEL_WIDTH, top: 22, bottom: BANDWIDTH_HEIGHT - 5 };
    const parts = [
      `<circle cx="${offset + 4}" cy="7" r="4" fill="${color}"/>`,
      text(offset + 13, 11, "Mbps over time", { size: 11, fill: theme.inkSecondary }),
    ];

    // Each transfer spans its share of the elapsed time, so long transfers dominate as they do in practice.
    const spans = samples
      .filter((sample) => sample.direction === direction)
      .map((sample) => ({ bps: sample.bps, durationMs: sample.durationMs, live: false }));
    if (live?.direction === direction) {
      spans.push({ bps: live.bps, durationMs: live.elapsedMs, live: true });
    }
    if (spans.length === 0) {
      parts.push(
        line(plot.left, plot.right, plot.bottom, plot.bottom, theme.grid),
        text((plot.left + plot.right) / 2, (plot.top + plot.bottom) / 2 + 4, "Waiting for the first transfer", {
          size: 11,
          fill: theme.muted,
          anchor: "middle",
        }),
      );
      return parts.join("");
    }

    const y = (bps: number) => plot.bottom - (Math.min(bps / 1e6, maxMbps) / maxMbps) * (plot.bottom - plot.top);
    for (const tick of [0, maxMbps / 2, maxMbps]) {
      parts.push(
        line(plot.left, plot.right, y(tick * 1e6), y(tick * 1e6), theme.grid),
        text(plot.left - 5, y(tick * 1e6) + 3, String(tick), { fill: theme.muted, anchor: "end" }),
      );
    }

    const totalMs = spans.reduce((sum, span) => sum + Math.max(span.durationMs, 1), 0);
    let elapsed = 0;
    const points = spans.map((span) => {
      const midpoint = elapsed + Math.max(span.durationMs, 1) / 2;
      elapsed += Math.max(span.durationMs, 1);
      return [plot.left + (midpoint / totalMs) * (plot.right - plot.left), y(span.bps)] as Point;
    });
    const curve: Point[] = [[plot.left, points[0][1]], ...points, [plot.right, points[points.length - 1][1]]];
    const path = monotonePath(curve);
    const gradient = `fill-${direction}`;
    defs.push(
      `<linearGradient id="${gradient}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.45"/><stop offset="1" stop-color="${color}" stop-opacity="0.02"/></linearGradient>`,
    );
    parts.push(
      `<path d="${path}L${fixed(plot.right)},${fixed(plot.bottom)}L${fixed(plot.left)},${fixed(plot.bottom)}Z" fill="url(#${gradient})"/>`,
      `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`,
      ...markers(points, spans, color),
    );

    const reference = summary[direction];
    if (reference != null) {
      parts.push(line(plot.left, plot.right, y(reference), y(reference), theme.inkSecondary, `stroke-width="1"`));
    }
    return parts.join("");
  });

  return svg(BANDWIDTH_HEIGHT, `<defs>${defs.join("")}</defs>${panels.join("")}`);
}

// Short transfers bunch up at the start of the time axis, so their markers are thinned to keep the line readable.
function markers(points: Point[], spans: { live: boolean }[], color: string): string[] {
  const result: string[] = [];
  let lastX = Infinity;
  for (let i = points.length - 1; i >= 0; i--) {
    const [px, py] = points[i];
    if (spans[i].live) {
      result.push(
        `<circle cx="${fixed(px)}" cy="${fixed(py)}" r="${LIVE_RADIUS}" fill="none" stroke="${color}" stroke-width="1.5"/>`,
      );
    } else if (lastX - px >= MIN_POINT_SPACING) {
      result.push(`<circle cx="${fixed(px)}" cy="${fixed(py)}" r="${POINT_RADIUS}" fill="${color}"/>`);
    } else {
      continue;
    }
    lastX = px;
  }
  return result;
}

export interface BoxStats {
  low: number;
  q1: number;
  median: number;
  q3: number;
  high: number;
}

// Tukey box plot: whiskers reach the furthest samples within 1.5 interquartile ranges of the box.
export function boxStats(samples: number[]): BoxStats | undefined {
  if (samples.length === 0) {
    return;
  }
  const q1 = percentile(samples, 0.25) as number;
  const q3 = percentile(samples, 0.75) as number;
  const spread = (q3 - q1) * WHISKER_IQR;
  const inside = samples.filter((value) => value >= q1 - spread && value <= q3 + spread);
  return {
    low: Math.min(...inside),
    q1,
    median: percentile(samples, 0.5) as number,
    q3,
    high: Math.max(...inside),
  };
}

export interface LatencyChartInput {
  latency: LatencySamples;
  summary: Summary;
}

export function latencyChart({ latency, summary }: LatencyChartInput, theme: Theme): string {
  const rows: { label: string; samples: number[]; median?: number; color: string }[] = [
    { label: "Idle", samples: latency.idle, median: summary.latency, color: theme.muted },
    { label: "Downloading", samples: latency.download, median: summary.downLoadedLatency, color: theme.download },
    { label: "Uploading", samples: latency.upload, median: summary.upLoadedLatency, color: theme.upload },
  ];
  const strip = { left: 96, right: CHART_WIDTH - 60 };
  // Scaling to the 95th percentile keeps a single slow probe from flattening the rest.
  const maxMs = niceCeiling(
    Math.max(
      10,
      (percentile(
        rows.flatMap((row) => row.samples),
        0.95,
      ) ?? 0) * 1.2,
    ),
  );
  const x = (ms: number) => strip.left + (Math.min(ms, maxMs) / maxMs) * (strip.right - strip.left);

  const parts = [
    text(0, 10, "Boxes span the middle half; lines mark the median. Lower is better.", { fill: theme.muted }),
    text(CHART_WIDTH, 10, "Median", { fill: theme.muted, anchor: "end" }),
  ];
  rows.forEach(({ label, samples, median, color }, index) => {
    const rowY = LATENCY_CAPTION_HEIGHT + 12 + index * LATENCY_ROW_HEIGHT;
    const boxY = rowY - 4;
    const dotsY = rowY + 8;
    const quantity = latencyQuantity(median);
    const stats = boxStats(samples);
    parts.push(
      text(0, boxY + 4, label, { size: 12, fill: theme.inkSecondary }),
      line(strip.left, strip.right, dotsY, dotsY, theme.grid),
      ...samples.map(
        (ms) => `<circle cx="${fixed(x(ms))}" cy="${dotsY}" r="${DOT_RADIUS}" fill="${color}" fill-opacity="0.6"/>`,
      ),
      text(CHART_WIDTH, boxY + 4, quantity ? `${quantity.value} ${quantity.unit}` : "Pending", {
        size: 12,
        fill: quantity ? theme.ink : theme.muted,
        anchor: "end",
      }),
    );
    if (stats) {
      const capTop = boxY - 3;
      const capBottom = boxY + 3;
      parts.push(
        line(x(stats.low), x(stats.high), boxY, boxY, color, `stroke-width="1"`),
        line(x(stats.low), x(stats.low), capTop, capBottom, color, `stroke-width="1"`),
        line(x(stats.high), x(stats.high), capTop, capBottom, color, `stroke-width="1"`),
        `<rect x="${fixed(x(stats.q1))}" y="${fixed(boxY - BOX_HEIGHT / 2)}" width="${fixed(Math.max(1, x(stats.q3) - x(stats.q1)))}" height="${BOX_HEIGHT}" rx="1.5" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="1"/>`,
        line(
          x(stats.median),
          x(stats.median),
          boxY - BOX_HEIGHT / 2,
          boxY + BOX_HEIGHT / 2,
          theme.ink,
          `stroke-width="2"`,
        ),
      );
    }
  });

  const axisY = LATENCY_CAPTION_HEIGHT + 8 + rows.length * LATENCY_ROW_HEIGHT;
  parts.push(
    text(strip.left, axisY, "0 ms", { fill: theme.muted, anchor: "middle" }),
    text(x(maxMs / 2), axisY, `${maxMs / 2} ms`, { fill: theme.muted, anchor: "middle" }),
    text(strip.right, axisY, `${maxMs} ms`, { fill: theme.muted, anchor: "end" }),
  );
  return svg(axisY + 4, parts.join(""));
}

export function markdownImage(markup: string, alt: string): string {
  return `![${alt}](data:image/svg+xml;base64,${Buffer.from(markup).toString("base64")}?raycast-width=${CHART_WIDTH})`;
}
