import { randomBytes } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";

export type Direction = "download" | "upload";

export interface RequestTiming {
  bytes: number;
  ttfb: number;
  serverTime: number;
  ping: number;
  duration: number;
  bps: number | undefined;
}

export interface TransferProgress {
  transferred: number;
  elapsedMs: number;
  bps: number;
}

export interface MeasureOptions {
  during?: Direction;
  signal?: AbortSignal;
  onProgress?: (progress: TransferProgress) => void;
}

export interface Connection {
  measure(direction: Direction, bytes: number, options?: MeasureOptions): Promise<RequestTiming>;
  close(): void;
}

export interface ConnectionMeta {
  clientIp?: string;
  asn?: number;
  asOrganization?: string;
  country?: string;
  city?: string;
  region?: string;
  httpProtocol?: string;
  colo?: { iata?: string; city?: string; cca2?: string; region?: string };
}

const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_CHUNK_BYTES = 1024 * 1024;
// Approximates HTTP framing on top of the payload, as speed.cloudflare.com does.
const HEADER_OVERHEAD = 1.005;
const SERVER_TIMING_PATTERN = /(?:^|,\s*)(?:cfSpeed[a-zA-Z]*|cfReq(?:uest)?Dur(?:ation)?);\s*dur=([0-9.]+)/gi;

export class HttpError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function parseRetryAfter(header: string | undefined, now = Date.now()): number | undefined {
  if (!header) {
    return;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds);
  }
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.round((date - now) / 1000));
}

export function createMeasurementId(): string {
  return randomBytes(8).readBigUInt64BE().toString().padStart(16, "1").slice(0, 16);
}

export function parseServerTime(header: string | string[] | undefined): number {
  const value = Array.isArray(header) ? header.join(", ") : (header ?? "");
  let total = 0;
  for (const match of value.matchAll(SERVER_TIMING_PATTERN)) {
    total += Number(match[1]);
  }
  return total;
}

let cachedUploadPayload: Buffer | undefined;

function uploadPayload(bytes: number): Buffer {
  if (cachedUploadPayload?.length !== bytes) {
    cachedUploadPayload = Buffer.alloc(bytes, "0");
  }
  return cachedUploadPayload;
}

export function createConnection(baseUrl: URL, measId: string): Connection {
  const isHttps = baseUrl.protocol === "https:";
  const client = isHttps ? https : http;
  // A single warm socket per connection keeps handshakes out of the timings.
  const agent = new client.Agent({ keepAlive: true, maxSockets: 1 });

  function measure(direction: Direction, bytes: number, { during, signal, onProgress }: MeasureOptions = {}) {
    const url = new URL(direction === "download" ? "__down" : "__up", baseUrl);
    url.searchParams.set("measId", measId);
    url.searchParams.set("bytes", String(bytes));
    if (during) {
      url.searchParams.set("during", during);
    }
    const body = direction === "upload" ? uploadPayload(bytes) : undefined;

    return new Promise<RequestTiming>((resolve, reject) => {
      let requestStart = 0;

      const req = client.request(
        url,
        {
          method: body ? "POST" : "GET",
          agent,
          signal,
          timeout: REQUEST_TIMEOUT_MS,
          headers: body ? { "content-type": "text/plain", "content-length": body.length } : undefined,
        },
        (res) => {
          const responseStart = performance.now();
          if (res.statusCode !== 200) {
            res.resume();
            const status = res.statusCode ?? 0;
            const retryAfter = parseRetryAfter(res.headers["retry-after"]);
            reject(new HttpError(`${direction} of ${bytes} bytes failed with HTTP ${status}`, status, retryAfter));
            return;
          }

          let received = 0;
          res.on("data", (chunk: Buffer) => {
            received += chunk.length;
            const elapsed = performance.now() - responseStart;
            if (onProgress && bytes > 0 && elapsed > 0) {
              onProgress({ transferred: received, elapsedMs: elapsed, bps: (received * 8) / (elapsed / 1000) });
            }
          });
          res.on("error", reject);
          res.on("end", () => {
            // Latency probes carrying a measId receive a short token instead of an empty body.
            if (direction === "download" && bytes > 0 && received !== bytes) {
              reject(new Error(`Download ended after ${received} of ${bytes} bytes`));
              return;
            }

            const responseEnd = performance.now();
            const ttfb = responseStart - requestStart;
            const serverTime = parseServerTime(res.headers["server-timing"]);
            const ping = Math.max(0, ttfb - serverTime);
            // Upload bodies are fully received by the time the server responds.
            const duration = direction === "download" ? ping + (responseEnd - responseStart) : ttfb;
            const bps = duration > 0 ? (bytes * HEADER_OVERHEAD * 8) / (duration / 1000) : undefined;
            resolve({ bytes, ttfb, serverTime, ping, duration, bps });
          });
        },
      );

      req.on("socket", (socket) => {
        const markRequestStart = () => (requestStart = performance.now());
        if (socket.connecting) {
          socket.once(isHttps ? "secureConnect" : "connect", markRequestStart);
        } else {
          markRequestStart();
        }
      });
      req.on("timeout", () => req.destroy(new Error(`${direction} of ${bytes} bytes timed out`)));
      req.on("error", reject);
      if (body) {
        writeBody(req, body, (written) => {
          const elapsed = performance.now() - requestStart;
          if (onProgress && requestStart > 0 && elapsed > 0) {
            onProgress({ transferred: written, elapsedMs: elapsed, bps: (written * 8) / (elapsed / 1000) });
          }
        }).catch(() => {
          // Write failures also surface through the request's error event.
        });
      } else {
        req.end();
      }
    });
  }

  return { measure, close: () => agent.destroy() };
}

// Writing in chunks with backpressure lets upload progress follow what the socket has accepted.
async function writeBody(req: http.ClientRequest, body: Buffer, onWritten: (written: number) => void) {
  for (let offset = 0; offset < body.length; offset += UPLOAD_CHUNK_BYTES) {
    const end = Math.min(offset + UPLOAD_CHUNK_BYTES, body.length);
    if (!req.write(body.subarray(offset, end))) {
      await once(req, "drain");
    }
    onWritten(end - req.writableLength);
  }
  req.end();
}

export async function fetchMeta(baseUrl: URL, signal?: AbortSignal): Promise<ConnectionMeta> {
  const response = await fetch(new URL("meta", baseUrl), {
    // The endpoint responds with an empty object unless the request appears to come from the site.
    headers: { referer: new URL("/", baseUrl).href },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Metadata request failed with HTTP ${response.status}`);
  }
  return (await response.json()) as ConnectionMeta;
}
