import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RequestTiming } from "../src/lib/engine/transport";
import {
  applyEvent,
  describeSkipped,
  describeStatus,
  failRun,
  finishRun,
  initialRunState,
  isRunning,
} from "../src/lib/run-state";
import type { RawResults } from "../src/lib/stats";

function timing(bytes: number, bps: number | undefined, duration = 500): RequestTiming {
  return { bytes, ttfb: 5, serverTime: 0, ping: 5, duration, bps };
}

function emptyRaw(): RawResults {
  return { latency: [], download: [], upload: [] };
}

describe("applyEvent", () => {
  it("starts in the connecting phase", () => {
    const state = initialRunState();
    assert.equal(state.phase, "starting");
    assert.equal(describeStatus(state), "Connecting");
    assert.ok(isRunning(state));
  });

  it("records connection details", () => {
    const meta = { asOrganization: "Example Network" };
    assert.deepEqual(applyEvent(initialRunState(), { type: "meta", meta }, emptyRaw()).meta, meta);
  });

  it("tracks idle latency and summarises it", () => {
    const raw = { ...emptyRaw(), latency: [4, 6] };
    const state = applyEvent(
      initialRunState(),
      { type: "latency", ping: 6, progress: { completed: 2, total: 20 } },
      raw,
    );
    assert.equal(state.phase, "latency");
    assert.deepEqual(state.latency.idle, [4, 6]);
    assert.equal(state.summary.latency, 5);
    assert.equal(describeStatus(state), "Measuring latency (2 of 20)");
  });

  it("records skipped transfers", () => {
    const skipped = { direction: "download" as const, bytes: 1e7, reason: "HTTP 429", status: 429 };
    const state = applyEvent(initialRunState(), { type: "skipped", skipped }, emptyRaw());
    assert.deepEqual(state.skipped, [skipped]);
  });

  it("shows transfer progress until the transfer completes", () => {
    const raw = emptyRaw();
    let state = applyEvent(
      initialRunState(),
      {
        type: "progress",
        direction: "download",
        bytes: 25e6,
        progress: { transferred: 10e6, elapsedMs: 800, bps: 100e6 },
      },
      raw,
    );
    assert.equal(state.phase, "download");
    assert.equal(state.live?.bps, 100e6);
    assert.equal(describeStatus(state), "Downloading 25 MB (40%)");

    raw.download.push({ bytes: 25e6, timings: [timing(25e6, 99e6)], loadedLatency: [] });
    state = applyEvent(state, { type: "bandwidth", direction: "download", timing: timing(25e6, 99e6) }, raw);
    assert.equal(state.live, undefined);
    assert.deepEqual(state.bandwidthSamples, [{ direction: "download", bytes: 25e6, bps: 99e6, durationMs: 500 }]);
    assert.equal(state.summary.download, 99e6);
  });

  it("keeps the live transfer while probing latency under load", () => {
    const progress = {
      type: "progress" as const,
      direction: "upload" as const,
      bytes: 1e7,
      progress: { transferred: 1e6, elapsedMs: 400, bps: 20e6 },
    };
    const loaded = applyEvent(
      applyEvent(initialRunState(), progress, emptyRaw()),
      { type: "latency", ping: 9, during: "upload" },
      emptyRaw(),
    );
    assert.equal(loaded.phase, "upload");
    assert.notEqual(loaded.live, undefined);
  });

  it("skips transfers without a measurable speed", () => {
    const state = applyEvent(
      initialRunState(),
      { type: "bandwidth", direction: "upload", timing: timing(1e5, undefined) },
      emptyRaw(),
    );
    assert.deepEqual(state.bandwidthSamples, []);
  });
});

describe("packet loss", () => {
  it("records the measured loss, or null when unavailable", () => {
    const packetLoss = { sent: 1000, received: 998, lossRatio: 0.002 };
    assert.deepEqual(
      applyEvent(initialRunState(), { type: "packetLoss", packetLoss }, emptyRaw()).packetLoss,
      packetLoss,
    );
    assert.equal(
      applyEvent(initialRunState(), { type: "packetLoss", packetLoss: undefined }, emptyRaw()).packetLoss,
      null,
    );
  });

  it("feeds measured loss into the quality scores", () => {
    const summary = { latency: 6, jitter: 3.2, download: 129.7e6, downLoadedLatency: 10, upLoadedLatency: 10 };
    const packetLoss = { sent: 1000, received: 1000, lossRatio: 0 };
    const state = finishRun(initialRunState(), { raw: emptyRaw(), summary, skipped: [], packetLoss }, 30_000);
    assert.equal(state.scores?.streaming?.points, 80);
    assert.deepEqual(state.packetLoss, packetLoss);
  });
});

describe("finishRun", () => {
  it("adds quality scores and the duration", () => {
    const raw: RawResults = {
      latency: [5, 5],
      download: [{ bytes: 1e7, timings: [timing(1e7, 120e6)], loadedLatency: [9, 11] }],
      upload: [],
    };
    const result = { raw, summary: { latency: 5, jitter: 0, download: 120e6, downLoadedLatency: 10 }, skipped: [] };
    const state = finishRun(initialRunState(), result, 33_000);

    assert.equal(state.phase, "finished");
    assert.equal(isRunning(state), false);
    assert.equal(state.scores?.streaming?.rating, "great");
    assert.equal(describeStatus(state), "Finished in 33.0 s");
  });

  it("marks a run with skipped transfers as partial", () => {
    const skipped = [{ direction: "download" as const, bytes: 1e7, reason: "HTTP 429", status: 429 }];
    const state = finishRun(initialRunState(), { raw: emptyRaw(), summary: {}, skipped }, 20_000);
    assert.equal(describeStatus(state), "Finished early in 20.0 s");
  });
});

describe("describeSkipped", () => {
  it("says nothing when every transfer ran", () => {
    assert.equal(describeSkipped([]), undefined);
  });

  it("explains rate limiting with the suggested wait", () => {
    const notice = describeSkipped([
      { direction: "download", bytes: 1e7, reason: "HTTP 429", status: 429, retryAfterSeconds: 3116 },
      { direction: "upload", bytes: 1e7, reason: "HTTP 429", status: 429, retryAfterSeconds: 60 },
    ]);
    assert.equal(
      notice,
      "Cloudflare is rate limiting large transfers from this network, so the download and upload test stopped early and results may be less accurate. Try again in about 52 min for a full result.",
    );
  });

  it("names the failure for other errors", () => {
    assert.equal(
      describeSkipped([{ direction: "upload", bytes: 1e7, reason: "upload of 10000000 bytes timed out" }]),
      "The upload test stopped early after a transfer failed (upload of 10000000 bytes timed out), so results may be less accurate.",
    );
  });
});

describe("failRun", () => {
  it("keeps partial results and records the reason", () => {
    const partial = applyEvent(initialRunState(), { type: "latency", ping: 5 }, { ...emptyRaw(), latency: [5] });
    const state = failRun(partial, new Error("download of 1000 bytes failed with HTTP 429"));

    assert.equal(state.phase, "failed");
    assert.equal(state.summary.latency, 5);
    assert.equal(state.error, "download of 1000 bytes failed with HTTP 429");
    assert.equal(describeStatus(state), "Failed");
  });
});
