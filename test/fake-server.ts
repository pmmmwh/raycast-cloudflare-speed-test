import http from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  path: string;
  bytes: number;
  during: string | null;
  measId: string | null;
  bodyLength: number;
}

export interface FakeServerOptions {
  delayMs?: (request: RecordedRequest) => number;
  serverTimeMs?: number;
  status?: number;
  truncateDownloads?: boolean;
  failMeta?: boolean;
  throttleDownloads?: boolean;
  rateLimit?: (request: RecordedRequest) => boolean;
}

export interface FakeServer {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export const RATE_LIMIT_RETRY_AFTER_SECONDS = 3116;

export const LATENCY_TOKEN = "___fake-latency-token";

export const FAKE_META = {
  clientIp: "192.0.2.1",
  asn: 64496,
  asOrganization: "Example Network",
  colo: { iata: "ARN", city: "Stockholm" },
};

export async function startFakeServer({
  delayMs = () => 0,
  serverTimeMs = 0,
  status = 200,
  truncateDownloads = false,
  failMeta = false,
  throttleDownloads = false,
  rateLimit = () => false,
}: FakeServerOptions = {}): Promise<FakeServer> {
  const requests: RecordedRequest[] = [];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/meta") {
      if (failMeta) {
        res.statusCode = 500;
        res.end();
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.headers.referer ? FAKE_META : {}));
      return;
    }

    let bodyLength = 0;
    for await (const chunk of req) {
      bodyLength += (chunk as Buffer).length;
    }

    const request: RecordedRequest = {
      path: url.pathname,
      bytes: Number(url.searchParams.get("bytes")),
      during: url.searchParams.get("during"),
      measId: url.searchParams.get("measId"),
      bodyLength,
    };
    requests.push(request);

    const delay = delayMs(request);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (rateLimit(request)) {
      res.statusCode = 429;
      res.setHeader("retry-after", String(RATE_LIMIT_RETRY_AFTER_SECONDS));
      res.end();
      return;
    }

    res.statusCode = status;
    res.setHeader("server-timing", `cfSpeedEdge;dur=0, cfSpeedWorker;dur=${serverTimeMs}`);
    if (request.path !== "/__down" || status !== 200) {
      res.end();
    } else if (request.bytes === 0) {
      res.end(LATENCY_TOKEN);
    } else if (throttleDownloads) {
      await sendSlowly(res, request.bytes);
    } else {
      res.end(Buffer.alloc(truncateDownloads ? request.bytes - 1 : request.bytes));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const THROTTLE_CHUNKS = 10;
const THROTTLE_INTERVAL_MS = 80;

async function sendSlowly(res: http.ServerResponse, bytes: number) {
  const chunk = Buffer.alloc(bytes / THROTTLE_CHUNKS);
  for (let i = 0; i < THROTTLE_CHUNKS; i++) {
    res.write(chunk);
    await new Promise((resolve) => setTimeout(resolve, THROTTLE_INTERVAL_MS));
  }
  res.end();
}
