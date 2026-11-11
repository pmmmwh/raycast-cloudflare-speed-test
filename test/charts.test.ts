import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHART_WIDTH,
  DARK_THEME,
  LIGHT_THEME,
  bandwidthChart,
  boxStats,
  latencyChart,
  markdownImage,
  monotonePath,
  niceCeiling,
} from "../src/lib/charts";
import type { BandwidthSample } from "../src/lib/run-state";

const emptyLatency = { idle: [], download: [], upload: [] };

function assertWellFormed(svg: string) {
  assert.match(svg, new RegExp(`^<svg [^>]*width="${CHART_WIDTH}"[^>]*>.*</svg>$`, "s"));
  assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
  assert.doesNotMatch(svg, new RegExp(`<rect[^>]*width="${CHART_WIDTH}"`), "charts have no background of their own");
}

function sample(direction: BandwidthSample["direction"], mbps: number, durationMs: number): BandwidthSample {
  return { direction, bytes: 1e6, bps: mbps * 1e6, durationMs };
}

describe("niceCeiling", () => {
  it("rounds up to a readable axis maximum", () => {
    assert.equal(niceCeiling(153), 200);
    assert.equal(niceCeiling(105), 120);
    assert.equal(niceCeiling(99.8), 100);
    assert.equal(niceCeiling(2.1), 2.5);
    assert.equal(niceCeiling(12), 12);
  });
});

describe("monotonePath", () => {
  it("draws a smooth curve through every point", () => {
    const path = monotonePath([
      [0, 10],
      [10, 0],
      [20, 5],
    ]);
    assert.match(path, /^M0\.0,10\.0C.*,10\.0,0\.0C.*,20\.0,5\.0$/);
  });

  it("never overshoots the samples between points", () => {
    const path = monotonePath([
      [0, 50],
      [10, 50],
      [20, 0],
      [30, 0],
    ]);
    const ys = [...path.matchAll(/,(-?[\d.]+)/g)].map((match) => Number(match[1]));
    assert.ok(Math.min(...ys) >= 0 && Math.max(...ys) <= 50, `control points stay within the data: ${ys}`);
  });

  it("handles a single point", () => {
    assert.equal(monotonePath([[5, 5]]), "M5.0,5.0");
  });
});

describe("bandwidthChart", () => {
  it("shows a waiting message in each panel before any transfer", () => {
    const svg = bandwidthChart({ samples: [], summary: {} }, LIGHT_THEME);
    assertWellFormed(svg);
    assert.equal(svg.match(/Waiting for the first transfer/g)?.length, 2);
  });

  it("draws an area curve per direction with an unlabelled 90th percentile line", () => {
    const svg = bandwidthChart(
      {
        samples: [sample("download", 95, 80), sample("download", 131, 800), sample("upload", 99, 900)],
        summary: { download: 131e6, upload: 99e6 },
      },
      DARK_THEME,
    );
    assertWellFormed(svg);
    assert.equal(svg.match(/fill="url\(#fill-(download|upload)\)"/g)?.length, 2);
    assert.match(svg, new RegExp(`stroke="${DARK_THEME.download}" stroke-width="2"`));
    assert.match(svg, new RegExp(`stroke="${DARK_THEME.upload}" stroke-width="2"`));
    assert.equal(svg.match(new RegExp(`stroke="${DARK_THEME.inkSecondary}" stroke-width="1"`, "g"))?.length, 2);
    assert.doesNotMatch(svg, /90th percentile/);
    assert.doesNotMatch(svg, /Waiting for the first transfer/);
  });

  it("spaces transfers by how long they took", () => {
    const svg = bandwidthChart(
      { samples: [sample("download", 50, 100), sample("download", 100, 900)], summary: {} },
      LIGHT_THEME,
    );
    const xs = [...svg.matchAll(new RegExp(`<circle cx="([\\d.]+)"[^>]*r="2" fill="${LIGHT_THEME.download}"`, "g"))]
      .map((match) => Number(match[1]))
      .sort((a, b) => a - b);
    const plotWidth = (CHART_WIDTH - 16) / 2 - 26;
    assert.ok(Math.abs(xs[0] - (26 + plotWidth * 0.05)) < 1, `short transfer near the start: ${xs[0]}`);
    assert.ok(Math.abs(xs[1] - (26 + plotWidth * 0.55)) < 1, `long transfer mid-way: ${xs[1]}`);
  });

  it("thins markers that would overlap", () => {
    const crowded = Array.from({ length: 20 }, () => sample("download", 100, 10)).concat(sample("download", 100, 2000));
    const svg = bandwidthChart({ samples: crowded, summary: {} }, LIGHT_THEME);
    const markers = svg.match(new RegExp(`r="2" fill="${LIGHT_THEME.download}"`, "g"))?.length ?? 0;
    assert.ok(markers < crowded.length && markers >= 2, `expected thinned markers, saw ${markers}`);
  });

  it("draws the transfer in progress as an outlined marker", () => {
    const svg = bandwidthChart(
      {
        samples: [],
        summary: {},
        live: { direction: "upload", bytes: 1e7, transferred: 4e6, elapsedMs: 400, bps: 80e6 },
      },
      LIGHT_THEME,
    );
    assertWellFormed(svg);
    assert.match(svg, new RegExp(`fill="none" stroke="${LIGHT_THEME.upload}" stroke-width="1.5"`));
    assert.equal(svg.match(/Waiting for the first transfer/g)?.length, 1);
  });
});

describe("boxStats", () => {
  it("computes quartiles and Tukey whiskers", () => {
    const stats = boxStats([...Array.from({ length: 20 }, (_, i) => 4 + (i % 5) * 0.5), 250]);
    assert.equal(stats?.median, 5);
    assert.equal(stats?.low, 4);
    assert.equal(stats?.high, 6);
    assert.ok(stats != null && stats.q1 < stats.median && stats.median < stats.q3);
  });

  it("is undefined without samples", () => {
    assert.equal(boxStats([]), undefined);
  });
});

describe("latencyChart", () => {
  it("marks rows without samples as pending", () => {
    const svg = latencyChart({ latency: emptyLatency, summary: {} }, LIGHT_THEME);
    assertWellFormed(svg);
    assert.equal(svg.match(/>Pending</g)?.length, 3);
    assert.match(svg, />Boxes span the middle half; lines mark the median\. Lower is better\.</);
    assert.match(svg, />Median</);
  });

  it("draws a box per row with samples and keeps outliers inside the chart", () => {
    const svg = latencyChart(
      {
        latency: {
          idle: [...Array.from({ length: 20 }, (_, i) => 4 + (i % 3)), 250],
          download: [8, 9, 10, 11],
          upload: [],
        },
        summary: { latency: 5, downLoadedLatency: 9.5 },
      },
      DARK_THEME,
    );
    assertWellFormed(svg);
    assert.equal(svg.match(/<rect /g)?.length, 2);
    assert.match(svg, />5\.0 ms</);
    assert.match(svg, />9\.5 ms</);
    const dots = [...svg.matchAll(/<circle cx="([\d.]+)"/g)].map((match) => Number(match[1]));
    assert.ok(Math.max(...dots) <= CHART_WIDTH - 60);
    assert.match(svg, /text-anchor="end"[^>]*>15 ms</);
  });
});

describe("latencyChart labels", () => {
  it("aligns row labels and values with the box rather than the dots", () => {
    const svg = latencyChart({ latency: { ...emptyLatency, idle: [4, 5, 6] }, summary: { latency: 5 } }, LIGHT_THEME);
    const boxCentre = Number(svg.match(/<rect x="[\d.]+" y="([\d.]+)"[^>]*height="9"/)?.[1]) + 4.5;
    const labelY = Number(svg.match(/y="([\d.]+)"[^>]*>Idle</)?.[1]);
    const valueY = Number(svg.match(/y="([\d.]+)"[^>]*>5\.0 ms</)?.[1]);
    assert.equal(labelY, boxCentre + 4);
    assert.equal(valueY, boxCentre + 4);
  });
});

describe("markdownImage", () => {
  it("embeds the image as a data URI sized to the pane", () => {
    assert.equal(
      markdownImage("<svg/>", "Frame 1"),
      `![Frame 1](data:image/svg+xml;base64,PHN2Zy8+?raycast-width=${CHART_WIDTH})`,
    );
  });
});
