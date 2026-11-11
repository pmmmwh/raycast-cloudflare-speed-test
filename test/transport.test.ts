import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  HttpError,
  createConnection,
  createMeasurementId,
  fetchMeta,
  parseRetryAfter,
  parseServerTime,
} from "../src/lib/engine/transport";
import { FAKE_META, startFakeServer, type FakeServer } from "./fake-server";

describe("parseServerTime", () => {
  it("sums every cfSpeed entry", () => {
    assert.equal(parseServerTime("cfSpeedEdge;dur=3, cfSpeedWorker;dur=19"), 22);
  });

  it("reads the legacy request duration entry", () => {
    assert.equal(parseServerTime("cfRequestDuration;dur=12.5"), 12.5);
  });

  it("ignores entries that are not server processing time", () => {
    assert.equal(parseServerTime('cfL4;desc="?proto=TCP&rtt=2293&min_rtt=2179"'), 0);
  });

  it("combines repeated headers", () => {
    assert.equal(parseServerTime(["cfSpeedEdge;dur=3", 'cfL4;desc="?rtt=1"', "cfSpeedWorker;dur=4"]), 7);
  });

  it("treats a missing header as no server time", () => {
    assert.equal(parseServerTime(undefined), 0);
  });
});

describe("parseRetryAfter", () => {
  it("reads a delay in seconds", () => {
    assert.equal(parseRetryAfter("3116"), 3116);
  });

  it("reads an HTTP date relative to now", () => {
    const now = Date.parse("2026-10-25T18:00:00Z");
    assert.equal(parseRetryAfter("Sun, 25 Oct 2026 18:02:00 GMT", now), 120);
  });

  it("ignores missing or unreadable values", () => {
    assert.equal(parseRetryAfter(undefined), undefined);
    assert.equal(parseRetryAfter("soon"), undefined);
  });
});

describe("createMeasurementId", () => {
  it("creates a 16-digit identifier", () => {
    assert.match(createMeasurementId(), /^[1-9]\d{15}$/);
  });
});

describe("createConnection", () => {
  let server: FakeServer;

  before(async () => {
    server = await startFakeServer({ delayMs: () => 60, serverTimeMs: 60 });
  });

  after(() => server.close());

  it("subtracts server processing time from latency", async () => {
    const connection = createConnection(new URL(server.url), "1234567890123456");
    try {
      const timing = await connection.measure("download", 0);
      assert.ok(timing.ttfb >= 55, `ttfb ${timing.ttfb}`);
      assert.equal(timing.serverTime, 60);
      assert.ok(timing.ping < 30, `ping ${timing.ping}`);
    } finally {
      connection.close();
    }
  });

  it("downloads the requested payload and reports its speed", async () => {
    const connection = createConnection(new URL(server.url), "1234567890123456");
    try {
      const timing = await connection.measure("download", 1e5, { during: "upload" });
      assert.equal(timing.bytes, 1e5);
      assert.ok(timing.duration > 0 && timing.bps != null && timing.bps > 0);
      assert.deepEqual(server.requests.at(-1), {
        path: "/__down",
        bytes: 1e5,
        during: "upload",
        measId: "1234567890123456",
        bodyLength: 0,
      });
    } finally {
      connection.close();
    }
  });

  it("uploads the requested payload", async () => {
    const connection = createConnection(new URL(server.url), "1234567890123456");
    try {
      const timing = await connection.measure("upload", 2e5);
      assert.equal(timing.duration, timing.ttfb);
      assert.equal(server.requests.at(-1)?.path, "/__up");
      assert.equal(server.requests.at(-1)?.bodyLength, 2e5);
    } finally {
      connection.close();
    }
  });

  it("reuses a single socket across requests", async () => {
    const connection = createConnection(new URL(server.url), "1234567890123456");
    try {
      await connection.measure("download", 0);
      const timing = await connection.measure("download", 0);
      assert.ok(timing.ping < 30, `ping ${timing.ping}`);
    } finally {
      connection.close();
    }
  });
});

describe("createConnection failures", () => {
  it("rejects responses other than 200", async () => {
    const server = await startFakeServer({ status: 429 });
    const connection = createConnection(new URL(server.url), "1234567890123456");
    try {
      await assert.rejects(
        connection.measure("download", 1e3),
        (error: Error) => error instanceof HttpError && error.status === 429 && /HTTP 429/.test(error.message),
      );
    } finally {
      connection.close();
      await server.close();
    }
  });

  it("rejects incomplete downloads", async () => {
    const server = await startFakeServer({ truncateDownloads: true });
    const connection = createConnection(new URL(server.url), "1234567890123456");
    try {
      await assert.rejects(connection.measure("download", 1e3), /999 of 1000 bytes/);
    } finally {
      connection.close();
      await server.close();
    }
  });

  it("stops when aborted", async () => {
    const server = await startFakeServer({ delayMs: () => 1000 });
    const connection = createConnection(new URL(server.url), "1234567890123456");
    try {
      await assert.rejects(
        connection.measure("download", 1e3, { signal: AbortSignal.timeout(50) }),
        (error: Error) => error.name === "AbortError" || error.name === "TimeoutError",
      );
    } finally {
      connection.close();
      await server.close();
    }
  });
});

describe("fetchMeta", () => {
  it("identifies itself with a referer to receive connection details", async () => {
    const server = await startFakeServer();
    try {
      assert.deepEqual(await fetchMeta(new URL(server.url)), FAKE_META);
    } finally {
      await server.close();
    }
  });
});
