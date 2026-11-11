import { randomBytes } from "node:crypto";
import dgram from "node:dgram";
import { lookup } from "node:dns/promises";
import { setTimeout as delay } from "node:timers/promises";

export interface StunServer {
  host: string;
  port: number;
}

export interface PacketLossResult {
  sent: number;
  received: number;
  lossRatio: number;
}

export interface PacketLossOptions {
  server?: StunServer;
  count?: number;
  batchSize?: number;
  batchIntervalMs?: number;
  responseTimeoutMs?: number;
  signal?: AbortSignal;
}

export const CLOUDFLARE_STUN: StunServer = { host: "stun.cloudflare.com", port: 3478 };

// Pacing and timeout follow speed.cloudflare.com's packet loss test.
const DEFAULT_COUNT = 1000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_BATCH_INTERVAL_MS = 10;
const DEFAULT_RESPONSE_TIMEOUT_MS = 5000;

const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;
const MAGIC_COOKIE = 0x2112a442;
const HEADER_BYTES = 20;
const TRANSACTION_ID_BYTES = 12;

export function bindingRequest(transactionId: Buffer): Buffer {
  const message = Buffer.alloc(HEADER_BYTES);
  message.writeUInt16BE(BINDING_REQUEST, 0);
  message.writeUInt16BE(0, 2);
  message.writeUInt32BE(MAGIC_COOKIE, 4);
  transactionId.copy(message, 8);
  return message;
}

export function responseTransactionId(message: Buffer): string | undefined {
  const isBindingSuccess =
    message.length >= HEADER_BYTES &&
    message.readUInt16BE(0) === BINDING_SUCCESS &&
    message.readUInt32BE(4) === MAGIC_COOKIE;
  return isBindingSuccess ? message.subarray(8, HEADER_BYTES).toString("hex") : undefined;
}

export async function measurePacketLoss({
  server = CLOUDFLARE_STUN,
  count = DEFAULT_COUNT,
  batchSize = DEFAULT_BATCH_SIZE,
  batchIntervalMs = DEFAULT_BATCH_INTERVAL_MS,
  responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS,
  signal,
}: PacketLossOptions = {}): Promise<PacketLossResult> {
  const { address, family } = await lookup(server.host);
  const socket = dgram.createSocket(family === 6 ? "udp6" : "udp4");
  const unanswered = new Set<string>();
  let sent = 0;
  let onAnswer = () => {};

  socket.on("message", (message) => {
    const id = responseTransactionId(message);
    if (id != null && unanswered.delete(id)) {
      onAnswer();
    }
  });

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(0, () => resolve());
    });

    while (sent < count) {
      for (let i = 0; i < batchSize && sent < count; i++, sent++) {
        const transactionId = randomBytes(TRANSACTION_ID_BYTES);
        unanswered.add(transactionId.toString("hex"));
        socket.send(bindingRequest(transactionId), server.port, address);
      }
      await delay(batchIntervalMs, undefined, { signal });
    }

    // Like Cloudflare, stop once everything is answered or replies have stopped arriving for a while.
    await new Promise<void>((resolve, reject) => {
      let timeout: NodeJS.Timeout;
      const finish = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        clearTimeout(timeout);
        reject(signal?.reason);
      };
      const restartTimeout = () => {
        clearTimeout(timeout);
        timeout = setTimeout(finish, responseTimeoutMs);
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      onAnswer = () => (unanswered.size === 0 ? finish() : restartTimeout());
      if (unanswered.size === 0) {
        finish();
      } else {
        restartTimeout();
      }
    });
  } finally {
    socket.close();
  }

  const received = sent - unanswered.size;
  return { sent, received, lossRatio: sent === 0 ? 0 : unanswered.size / sent };
}
