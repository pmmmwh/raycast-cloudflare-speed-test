import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bindingRequest, measurePacketLoss, responseTransactionId } from "../src/lib/engine/packet-loss";
import { startFakeStunServer } from "./fake-stun-server";

const FAST = { batchIntervalMs: 1, responseTimeoutMs: 200 };

describe("bindingRequest", () => {
  it("builds a STUN binding request header", () => {
    const id = Buffer.alloc(12, 7);
    const message = bindingRequest(id);
    assert.equal(message.length, 20);
    assert.equal(message.readUInt16BE(0), 0x0001);
    assert.equal(message.readUInt16BE(2), 0);
    assert.equal(message.readUInt32BE(4), 0x2112a442);
    assert.deepEqual(message.subarray(8), id);
  });
});

describe("responseTransactionId", () => {
  it("reads the transaction ID of a binding success response", () => {
    const response = bindingRequest(Buffer.alloc(12, 1));
    response.writeUInt16BE(0x0101, 0);
    assert.equal(responseTransactionId(response), "01".repeat(12));
  });

  it("ignores requests, other message types and short packets", () => {
    assert.equal(responseTransactionId(bindingRequest(Buffer.alloc(12))), undefined);
    assert.equal(responseTransactionId(Buffer.alloc(8)), undefined);
  });
});

describe("measurePacketLoss", () => {
  it("reports no loss when every request is answered", async () => {
    const stun = await startFakeStunServer();
    try {
      const result = await measurePacketLoss({ server: stun.server, count: 100, ...FAST });
      assert.deepEqual(result, { sent: 100, received: 100, lossRatio: 0 });
    } finally {
      await stun.close();
    }
  });

  it("counts unanswered requests as lost", async () => {
    const stun = await startFakeStunServer({ dropEvery: 10 });
    try {
      const result = await measurePacketLoss({ server: stun.server, count: 100, ...FAST });
      assert.deepEqual(result, { sent: 100, received: 90, lossRatio: 0.1 });
    } finally {
      await stun.close();
    }
  });

  it("finishes as soon as every request is answered", async () => {
    const stun = await startFakeStunServer();
    try {
      const startedAt = performance.now();
      await measurePacketLoss({ server: stun.server, count: 20, batchIntervalMs: 1, responseTimeoutMs: 5000 });
      assert.ok(performance.now() - startedAt < 1000);
    } finally {
      await stun.close();
    }
  });

  it("paces requests in batches", async () => {
    const stun = await startFakeStunServer();
    try {
      const startedAt = performance.now();
      await measurePacketLoss({
        server: stun.server,
        count: 50,
        batchSize: 10,
        batchIntervalMs: 40,
        responseTimeoutMs: 200,
      });
      assert.ok(performance.now() - startedAt >= 5 * 40 - 10);
      assert.equal(stun.requests(), 50);
    } finally {
      await stun.close();
    }
  });

  it("reports every request as lost when nothing answers", async () => {
    const stun = await startFakeStunServer({ silent: true });
    try {
      const result = await measurePacketLoss({ server: stun.server, count: 20, ...FAST });
      assert.deepEqual(result, { sent: 20, received: 0, lossRatio: 1 });
    } finally {
      await stun.close();
    }
  });

  it("stops when aborted", async () => {
    const stun = await startFakeStunServer({ silent: true });
    try {
      await assert.rejects(
        measurePacketLoss({ server: stun.server, count: 20, batchIntervalMs: 1, signal: AbortSignal.timeout(100) }),
        (error: Error) => error.name === "TimeoutError" || error.name === "AbortError",
      );
    } finally {
      await stun.close();
    }
  });
});
