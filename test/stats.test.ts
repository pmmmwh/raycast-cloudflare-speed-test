import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RequestTiming } from "../src/lib/engine/transport";
import { bandwidth, jitter, loadedLatencies, percentile, summarize, type BandwidthGroup } from "../src/lib/stats";

function timing(duration: number, bps: number | undefined): RequestTiming {
  return { bytes: 1e5, ttfb: duration, serverTime: 0, ping: 0, duration, bps };
}

function group(durations: number[], loadedLatency: number[] = []): BandwidthGroup {
  return { bytes: 1e5, timings: durations.map((duration) => timing(duration, 1e6)), loadedLatency };
}

describe("percentile", () => {
  it("returns undefined without values", () => {
    assert.equal(percentile([], 0.5), undefined);
  });

  it("returns the only value", () => {
    assert.equal(percentile([7], 0.9), 7);
  });

  it("interpolates between neighbouring values", () => {
    assert.equal(percentile([4, 1, 3, 2], 0.5), 2.5);
    assert.ok(Math.abs(percentile([1, 2, 3, 4], 0.9)! - 3.7) < 1e-9);
  });

  it("does not reorder its input", () => {
    const values = [3, 1, 2];
    percentile(values, 0.5);
    assert.deepEqual(values, [3, 1, 2]);
  });
});

describe("jitter", () => {
  it("needs at least two samples", () => {
    assert.equal(jitter([]), undefined);
    assert.equal(jitter([5]), undefined);
  });

  it("averages the absolute difference between consecutive samples", () => {
    assert.equal(jitter([5, 7, 4]), 2.5);
  });
});

describe("bandwidth", () => {
  it("takes the 90th percentile across all request sizes", () => {
    const groups: BandwidthGroup[] = [
      { bytes: 1e5, timings: [timing(20, 10), timing(20, 20)], loadedLatency: [] },
      { bytes: 1e6, timings: [timing(20, 30), timing(20, 40)], loadedLatency: [] },
    ];
    assert.ok(Math.abs(bandwidth(groups)! - 37) < 1e-9);
  });

  it("ignores requests too short to time and those without a speed", () => {
    const groups: BandwidthGroup[] = [
      { bytes: 1e5, timings: [timing(5, 999), timing(20, undefined), timing(20, 50)], loadedLatency: [] },
    ];
    assert.equal(bandwidth(groups), 50);
  });

  it("returns undefined without usable samples", () => {
    assert.equal(bandwidth([]), undefined);
  });
});

describe("loadedLatencies", () => {
  it("drops probes from groups containing any short transfer", () => {
    const groups = [group([300, 249], [1, 2]), group([250, 400], [3, 4])];
    assert.deepEqual(loadedLatencies(groups), [3, 4]);
  });

  it("keeps only the most recent 20 probes", () => {
    const probes = Array.from({ length: 25 }, (_, i) => i);
    assert.deepEqual(loadedLatencies([group([500], probes)]), probes.slice(5));
  });
});

describe("summarize", () => {
  it("leaves every metric undefined without samples", () => {
    const summary = summarize({ latency: [], download: [], upload: [] });
    assert.ok(Object.values(summary).every((value) => value == null));
  });

  it("combines latency and bandwidth samples", () => {
    const summary = summarize({
      latency: [4, 6, 5],
      download: [group([500], [10, 12])],
      upload: [],
    });
    assert.equal(summary.latency, 5);
    assert.equal(summary.jitter, 1.5);
    assert.equal(summary.download, 1e6);
    assert.equal(summary.upload, undefined);
    assert.equal(summary.downLoadedLatency, 11);
    assert.equal(summary.downLoadedJitter, 2);
  });
});
