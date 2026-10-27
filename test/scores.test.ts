import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ratingStars } from "../src/lib/report";
import { loadedLatencyIncrease, scoreQuality } from "../src/lib/scores";
import type { Summary } from "../src/lib/stats";

// Summary values from a speed.cloudflare.com run that reported 80, 50 and 60 points.
const websiteRun: Summary = {
  download: 129.7e6,
  upload: 97.7e6,
  latency: 6,
  jitter: 3.2,
  downLoadedLatency: 10,
  upLoadedLatency: 10,
};

describe("scoreQuality", () => {
  it("matches the website's points when packet loss is measured", () => {
    assert.deepEqual(scoreQuality(websiteRun, 0), {
      streaming: { points: 80, rating: "great" },
      gaming: { points: 50, rating: "great" },
      videoCalls: { points: 60, rating: "great" },
    });
  });

  it("leaves packet loss out rather than penalising it when unmeasured", () => {
    assert.deepEqual(scoreQuality(websiteRun), {
      streaming: { points: 70, rating: "great" },
      gaming: { points: 40, rating: "great" },
      videoCalls: { points: 50, rating: "great" },
    });
  });

  it("rates a congested connection lower", () => {
    const scores = scoreQuality({ download: 8e6, latency: 60, jitter: 25, downLoadedLatency: 260 });
    assert.deepEqual(scores, {
      streaming: { points: 0, rating: "bad" },
      gaming: { points: 0, rating: "bad" },
      videoCalls: { points: 0, rating: "bad" },
    });
  });

  it("counts a total on a threshold as the higher rating", () => {
    const scores = scoreQuality({ download: 50e6, latency: 15, jitter: 15, downLoadedLatency: 40 });
    assert.deepEqual(scores, {
      streaming: { points: 35, rating: "average" },
      gaming: { points: 15, rating: "average" },
      videoCalls: { points: 20, rating: "average" },
    });
  });

  it("skips experiences missing an input", () => {
    assert.deepEqual(scoreQuality({ download: 100e6, latency: 5 }), {});
    assert.deepEqual(Object.keys(scoreQuality({ latency: 5, upLoadedLatency: 8 })), ["gaming"]);
  });
});

describe("loadedLatencyIncrease", () => {
  it("uses the worse of the loaded latencies", () => {
    assert.equal(loadedLatencyIncrease({ latency: 5, downLoadedLatency: 9, upLoadedLatency: 12 }), 7);
  });

  it("uses whichever loaded latency is available", () => {
    assert.equal(loadedLatencyIncrease({ latency: 5, upLoadedLatency: 12 }), 7);
  });

  it("is undefined without idle or loaded latency", () => {
    assert.equal(loadedLatencyIncrease({ latency: 5 }), undefined);
    assert.equal(loadedLatencyIncrease({ downLoadedLatency: 9 }), undefined);
  });
});

describe("ratingStars", () => {
  it("shows one to five filled stars from bad to great", () => {
    assert.equal(ratingStars("bad"), "★☆☆☆☆");
    assert.equal(ratingStars("average"), "★★★☆☆");
    assert.equal(ratingStars("great"), "★★★★★");
  });
});
