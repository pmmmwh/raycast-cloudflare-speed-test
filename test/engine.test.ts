import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runSpeedTest, type SpeedTestEvent } from "../src/lib/engine/engine";
import type { Measurement } from "../src/lib/engine/plan";
import { startFakeStunServer } from "./fake-stun-server";
import { FAKE_META, RATE_LIMIT_RETRY_AFTER_SECONDS, startFakeServer, type RecordedRequest } from "./fake-server";

const isTransfer = (request: RecordedRequest) => request.bytes > 0;

describe("runSpeedTest", () => {
  it("runs every measurement in the plan and summarises the samples", async () => {
    // Transfers shorter than 10 ms are discarded as untimeable.
    const server = await startFakeServer({ delayMs: (request) => (isTransfer(request) ? 20 : 0) });
    const plan: Measurement[] = [
      { type: "latency", count: 3 },
      { type: "download", bytes: 1e5, count: 2 },
      { type: "upload", bytes: 1e5, count: 2 },
    ];
    const events: SpeedTestEvent[] = [];
    try {
      const result = await runSpeedTest({
        baseUrl: server.url,
        packetLoss: null,
        plan,
        onEvent: (event) => events.push(event),
      });

      assert.deepEqual(result.meta, FAKE_META);
      assert.equal(result.raw.latency.length, 3);
      assert.equal(result.raw.download[0].timings.length, 2);
      assert.equal(result.raw.upload[0].timings.length, 2);
      assert.notEqual(result.summary.latency, undefined);
      assert.notEqual(result.summary.download, undefined);
      assert.notEqual(result.summary.upload, undefined);

      assert.equal(events.filter((event) => event.type === "meta").length, 1);
      assert.equal(events.filter((event) => event.type === "latency" && !event.during).length, 3);
      assert.equal(events.filter((event) => event.type === "bandwidth").length, 4);

      const measIds = new Set(server.requests.map((request) => request.measId));
      assert.equal(measIds.size, 1);
      assert.match([...measIds][0] ?? "", /^\d{16}$/);
    } finally {
      await server.close();
    }
  });

  it("stops growing a direction once its requests take longer than a second", async () => {
    const server = await startFakeServer({
      delayMs: (request) => (request.path === "/__down" && request.bytes === 1e3 ? 1100 : 0),
    });
    const plan: Measurement[] = [
      { type: "download", bytes: 1e3, count: 1 },
      { type: "upload", bytes: 1e3, count: 1 },
      { type: "download", bytes: 2e3, count: 1 },
      { type: "upload", bytes: 2e3, count: 1 },
    ];
    try {
      await runSpeedTest({ baseUrl: server.url, packetLoss: null, plan });

      const transfers = server.requests.filter(isTransfer).map((request) => `${request.path} ${request.bytes}`);
      assert.deepEqual(transfers, ["/__down 1000", "/__up 1000", "/__up 2000"]);
    } finally {
      await server.close();
    }
  });

  it("keeps escalating after a slow warm-up request", async () => {
    const server = await startFakeServer({ delayMs: (request) => (request.bytes === 1e3 ? 1100 : 0) });
    const plan: Measurement[] = [
      { type: "download", bytes: 1e3, count: 1, bypassMinDuration: true },
      { type: "download", bytes: 2e3, count: 1 },
    ];
    try {
      await runSpeedTest({ baseUrl: server.url, packetLoss: null, plan });

      assert.deepEqual(
        server.requests.filter(isTransfer).map((request) => request.bytes),
        [1e3, 2e3],
      );
    } finally {
      await server.close();
    }
  });

  it("probes latency on a separate connection while a transfer is running", async () => {
    const server = await startFakeServer({ delayMs: (request) => (isTransfer(request) ? 600 : 0) });
    const plan: Measurement[] = [{ type: "download", bytes: 1e3, count: 1 }];
    try {
      const result = await runSpeedTest({ baseUrl: server.url, packetLoss: null, plan });

      const probes = server.requests.filter((request) => request.during === "download");
      assert.ok(probes.length >= 1, `expected loaded latency probes, saw ${probes.length}`);
      assert.equal(result.raw.download[0].loadedLatency.length, probes.length);
      assert.notEqual(result.summary.downLoadedLatency, undefined);
    } finally {
      await server.close();
    }
  });

  it("reports progress during long transfers, after local buffers have filled", async () => {
    const server = await startFakeServer({
      delayMs: (request) => (isTransfer(request) ? 50 : 0),
      throttleDownloads: true,
    });
    const plan: Measurement[] = [{ type: "download", bytes: 1e6, count: 1 }];
    const progress: number[] = [];
    try {
      await runSpeedTest({
        baseUrl: server.url,
        packetLoss: null,
        plan,
        onEvent: (event) => event.type === "progress" && progress.push(event.progress.elapsedMs),
      });

      assert.ok(progress.length >= 2, `expected progress events, saw ${progress.length}`);
      assert.ok(progress.every((elapsedMs) => elapsedMs >= 300));
    } finally {
      await server.close();
    }
  });

  it("keeps measuring after a direction is rate limited", async () => {
    const server = await startFakeServer({
      delayMs: (request) => (isTransfer(request) ? 20 : 0),
      rateLimit: (request) => request.path === "/__down" && request.bytes === 2e3,
    });
    const plan: Measurement[] = [
      { type: "latency", count: 1 },
      { type: "download", bytes: 1e3, count: 2 },
      { type: "download", bytes: 2e3, count: 2 },
      { type: "upload", bytes: 1e3, count: 2 },
      { type: "download", bytes: 3e3, count: 1 },
    ];
    const events: SpeedTestEvent[] = [];
    try {
      const result = await runSpeedTest({
        baseUrl: server.url,
        packetLoss: null,
        plan,
        onEvent: (event) => events.push(event),
      });

      assert.deepEqual(result.skipped, [
        {
          direction: "download",
          bytes: 2e3,
          reason: "download of 2000 bytes failed with HTTP 429",
          status: 429,
          retryAfterSeconds: RATE_LIMIT_RETRY_AFTER_SECONDS,
        },
      ]);
      assert.equal(events.filter((event) => event.type === "skipped").length, 1);
      assert.notEqual(result.summary.download, undefined);
      assert.notEqual(result.summary.upload, undefined);
      assert.deepEqual(
        server.requests.filter(isTransfer).map((request) => `${request.path} ${request.bytes}`),
        ["/__down 1000", "/__down 1000", "/__down 2000", "/__up 1000", "/__up 1000"],
      );
    } finally {
      await server.close();
    }
  });

  it("ends a direction whose warm-up transfer fails", async () => {
    const server = await startFakeServer({ rateLimit: (request) => request.path === "/__down" });
    const plan: Measurement[] = [
      { type: "download", bytes: 1e3, count: 1, bypassMinDuration: true },
      { type: "download", bytes: 2e3, count: 1 },
    ];
    try {
      const result = await runSpeedTest({ baseUrl: server.url, packetLoss: null, plan });
      assert.equal(result.skipped.length, 1);
      assert.equal(server.requests.filter(isTransfer).length, 1);
    } finally {
      await server.close();
    }
  });

  it("reports idle latency progress", async () => {
    const server = await startFakeServer();
    const progress: string[] = [];
    try {
      await runSpeedTest({
        baseUrl: server.url,
        packetLoss: null,
        plan: [{ type: "latency", count: 3 }],
        onEvent: (event) =>
          event.type === "latency" &&
          event.progress &&
          progress.push(`${event.progress.completed}/${event.progress.total}`),
      });
      assert.deepEqual(progress, ["1/3", "2/3", "3/3"]);
    } finally {
      await server.close();
    }
  });

  it("measures packet loss alongside the other measurements", async () => {
    const server = await startFakeServer();
    const stun = await startFakeStunServer({ dropEvery: 4 });
    const events: SpeedTestEvent[] = [];
    try {
      const result = await runSpeedTest({
        baseUrl: server.url,
        plan: [{ type: "latency", count: 2 }],
        packetLoss: { server: stun.server, count: 40, batchIntervalMs: 1, responseTimeoutMs: 200 },
        onEvent: (event) => events.push(event),
      });
      assert.deepEqual(result.packetLoss, { sent: 40, received: 30, lossRatio: 0.25 });
      assert.deepEqual(
        events.filter((event) => event.type === "packetLoss"),
        [{ type: "packetLoss", packetLoss: result.packetLoss }],
      );
    } finally {
      await server.close();
      await stun.close();
    }
  });

  it("treats packet loss as unavailable when nothing answers", async () => {
    const server = await startFakeServer();
    const stun = await startFakeStunServer({ silent: true });
    const events: SpeedTestEvent[] = [];
    try {
      const result = await runSpeedTest({
        baseUrl: server.url,
        plan: [{ type: "latency", count: 1 }],
        packetLoss: { server: stun.server, count: 10, batchIntervalMs: 1, responseTimeoutMs: 100 },
        onEvent: (event) => events.push(event),
      });
      assert.equal(result.packetLoss, undefined);
      assert.deepEqual(
        events.filter((event) => event.type === "packetLoss"),
        [{ type: "packetLoss", packetLoss: undefined }],
      );
    } finally {
      await server.close();
      await stun.close();
    }
  });

  it("rejects with an AbortError when cancelled", async () => {
    const server = await startFakeServer({ delayMs: (request) => (isTransfer(request) ? 1000 : 0) });
    const controller = new AbortController();
    const plan: Measurement[] = [
      { type: "latency", count: 1 },
      { type: "download", bytes: 1e3, count: 5 },
    ];
    try {
      await assert.rejects(
        runSpeedTest({
          baseUrl: server.url,
          packetLoss: null,
          plan,
          signal: controller.signal,
          onEvent: (event) => event.type === "latency" && controller.abort(),
        }),
        { name: "AbortError" },
      );
      assert.ok(server.requests.filter(isTransfer).length <= 1);
    } finally {
      await server.close();
    }
  });

  it("completes without connection details when they are unavailable", async () => {
    const server = await startFakeServer({ failMeta: true });
    const plan: Measurement[] = [{ type: "latency", count: 1 }];
    try {
      const result = await runSpeedTest({ baseUrl: server.url, packetLoss: null, plan });
      assert.equal(result.meta, undefined);
      assert.equal(result.raw.latency.length, 1);
    } finally {
      await server.close();
    }
  });
});
