import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEvent, failRun, finishRun, initialRunState, type RunState } from "../src/lib/run-state";
import { setTimeout as delay } from "node:timers/promises";
import { modeKey, modeTitle, runnerFor } from "../src/lib/run-modes";
import { SAMPLE_SCENARIOS, runSample, type SampleScenario, type SampleStage } from "../src/lib/sample-run";

async function play(scenario: SampleScenario): Promise<RunState> {
  let state = initialRunState();
  try {
    const result = await runSample(scenario, {
      pace: 0,
      onEvent: (event, raw) => (state = applyEvent(state, event, raw)),
    });
    return finishRun(state, result, 15_000);
  } catch (error) {
    return failRun(state, error);
  }
}

describe("runSample", () => {
  it("plays a typical run through to great ratings", async () => {
    const state = await play("typical");
    assert.equal(state.phase, "finished");
    assert.ok(Math.abs(state.summary.download! / 1e6 - 100) < 15);
    assert.ok(Math.abs(state.summary.upload! / 1e6 - 95) < 15);
    assert.notEqual(state.summary.downLoadedLatency, undefined);
    assert.notEqual(state.summary.upLoadedLatency, undefined);
    assert.deepEqual(state.packetLoss, { sent: 1000, received: 1000, lossRatio: 0 });
    assert.equal(state.scores?.streaming?.rating, "great");
  });

  it("skips large transfers when rate limited", async () => {
    const state = await play("rateLimited");
    assert.equal(state.phase, "finished");
    assert.deepEqual(
      state.skipped.map((skip) => [skip.direction, skip.bytes, skip.status]),
      [
        ["download", 1e7, 429],
        ["upload", 1e7, 429],
      ],
    );
  });

  it("reports packet loss as unavailable when UDP is blocked", async () => {
    const state = await play("udpBlocked");
    assert.equal(state.packetLoss, null);
  });

  it("fails partway with an error", async () => {
    const state = await play("failed");
    assert.equal(state.phase, "failed");
    assert.match(state.error ?? "", /network is unreachable/);
    assert.notEqual(state.summary.download, undefined);
    assert.equal(state.summary.upload, undefined);
  });

  it("rates a slow connection poorly", async () => {
    const state = await play("slow");
    assert.ok(state.summary.download! < 10e6);
    assert.ok(["bad", "poor"].includes(state.scores?.gaming?.rating ?? ""));
  });

  it("reaches gigabit speeds", async () => {
    const state = await play("gigabit");
    assert.ok(state.summary.download! > 800e6);
  });

  it("produces the same run every time", async () => {
    const first = await play("typical");
    const second = await play("typical");
    assert.deepEqual(first.summary, second.summary);
  });

  it("stops when aborted", async () => {
    await assert.rejects(runSample("typical", { pace: 1, signal: AbortSignal.timeout(50) }), (error: Error) =>
      ["AbortError", "TimeoutError"].includes(error.name),
    );
  });

  it("defines a title for every scenario", () => {
    assert.ok(Object.values(SAMPLE_SCENARIOS).every((profile) => profile.title.length > 0));
  });
});

async function freeze(stage: SampleStage): Promise<RunState> {
  let state = initialRunState();
  const controller = new AbortController();
  const run = runSample("typical", {
    pace: 0,
    freezeAt: stage,
    signal: controller.signal,
    onEvent: (event, raw) => (state = applyEvent(state, event, raw)),
  });
  await delay(100);
  controller.abort();
  await assert.rejects(run, { name: "AbortError" });
  return state;
}

describe("runSample freezeAt", () => {
  it("holds before anything is measured", async () => {
    const state = await freeze("starting");
    assert.equal(state.phase, "starting");
    assert.equal(state.meta, undefined);
  });

  it("holds halfway through idle latency", async () => {
    const state = await freeze("latency");
    assert.equal(state.phase, "latency");
    assert.deepEqual(state.latencyProgress, { completed: 10, total: 20 });
  });

  it("holds partway through a download with a transfer in progress", async () => {
    const state = await freeze("download");
    assert.equal(state.phase, "download");
    assert.equal(state.live?.direction, "download");
    assert.ok(state.live.transferred >= state.live.bytes / 2);
  });

  it("holds partway through an upload after downloads have finished", async () => {
    const state = await freeze("upload");
    assert.equal(state.phase, "upload");
    assert.equal(state.live?.direction, "upload");
    assert.notEqual(state.summary.download, undefined);
  });
});

describe("run modes", () => {
  it("reuses the same runner for the same mode", () => {
    assert.equal(runnerFor({ kind: "result", scenario: "slow" }), runnerFor({ kind: "result", scenario: "slow" }));
    assert.notEqual(runnerFor({ kind: "result", scenario: "slow" }), runnerFor({ kind: "replay", scenario: "slow" }));
  });

  it("labels sample modes so they are never mistaken for a real result", () => {
    assert.equal(modeTitle({ kind: "live" }), undefined);
    assert.equal(modeTitle({ kind: "result", scenario: "gigabit" }), "Sample Result: Gigabit Connection");
    assert.equal(modeTitle({ kind: "stage", scenario: "typical", stage: "upload" }), "Sample Stage: Uploading");
    assert.equal(modeKey({ kind: "stage", scenario: "typical", stage: "upload" }), "stage:typical:upload");
  });
});
