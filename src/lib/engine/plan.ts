import type { Direction } from "./transport";

export type Measurement =
  { type: "latency"; count: number } | { type: Direction; bytes: number; count: number; bypassMinDuration?: boolean };

// The default sequence used by speed.cloudflare.com (@cloudflare/speedtest).
export const DEFAULT_PLAN: Measurement[] = [
  { type: "latency", count: 2 },
  { type: "download", bytes: 1e5, count: 1, bypassMinDuration: true },
  { type: "latency", count: 20 },
  { type: "download", bytes: 1e5, count: 9 },
  { type: "latency", count: 2 },
  { type: "download", bytes: 1e6, count: 8 },
  { type: "latency", count: 2 },
  { type: "upload", bytes: 1e5, count: 8 },
  { type: "latency", count: 2 },
  { type: "upload", bytes: 1e6, count: 6 },
  { type: "latency", count: 2 },
  { type: "download", bytes: 1e7, count: 6 },
  { type: "latency", count: 2 },
  { type: "upload", bytes: 1e7, count: 4 },
  { type: "latency", count: 2 },
  { type: "download", bytes: 25e6, count: 4 },
  { type: "latency", count: 2 },
  { type: "upload", bytes: 25e6, count: 4 },
  { type: "latency", count: 2 },
  { type: "download", bytes: 1e8, count: 3 },
  { type: "latency", count: 2 },
  { type: "upload", bytes: 5e7, count: 3 },
  { type: "latency", count: 2 },
  { type: "download", bytes: 25e7, count: 2 },
];
