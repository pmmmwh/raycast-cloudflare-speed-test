import { setTimeout as delay } from "node:timers/promises";
import { summarize, type BandwidthGroup, type RawResults, type Summary } from "../stats";
import { measurePacketLoss, type PacketLossOptions, type PacketLossResult } from "./packet-loss";
import { DEFAULT_PLAN, type Measurement } from "./plan";
import {
  HttpError,
  createConnection,
  createMeasurementId,
  fetchMeta,
  type Connection,
  type ConnectionMeta,
  type Direction,
  type RequestTiming,
  type TransferProgress,
} from "./transport";

export interface LatencyProgress {
  completed: number;
  total: number;
}

export interface SkippedTransfer {
  direction: Direction;
  bytes: number;
  reason: string;
  status?: number;
  retryAfterSeconds?: number;
}

export type SpeedTestEvent =
  | { type: "meta"; meta: ConnectionMeta }
  | { type: "latency"; ping: number; during?: Direction; progress?: LatencyProgress }
  | { type: "skipped"; skipped: SkippedTransfer }
  | { type: "packetLoss"; packetLoss: PacketLossResult | undefined }
  | { type: "progress"; direction: Direction; bytes: number; progress: TransferProgress }
  | { type: "bandwidth"; direction: Direction; timing: RequestTiming };

export interface SpeedTestOptions {
  baseUrl?: string;
  plan?: Measurement[];
  packetLoss?: Omit<PacketLossOptions, "signal"> | null;
  signal?: AbortSignal;
  onEvent?: (event: SpeedTestEvent, raw: RawResults) => void;
}

export type SpeedTestRunner = (options: Pick<SpeedTestOptions, "signal" | "onEvent">) => Promise<SpeedTestResult>;

export interface SpeedTestResult {
  meta?: ConnectionMeta;
  raw: RawResults;
  summary: Summary;
  skipped: SkippedTransfer[];
  packetLoss?: PacketLossResult;
}

const DEFAULT_BASE_URL = "https://speed.cloudflare.com/";
const FINISH_REQUEST_DURATION_MS = 1000;
const LOADED_LATENCY_START_DELAY_MS = 20;
const LOADED_LATENCY_THROTTLE_MS = 400;
const PROGRESS_INTERVAL_MS = 100;
// Early readings mostly reflect local buffers filling rather than the link.
const PROGRESS_MIN_ELAPSED_MS = 300;

export async function runSpeedTest({
  baseUrl = DEFAULT_BASE_URL,
  plan = DEFAULT_PLAN,
  packetLoss: packetLossOptions = {},
  signal,
  onEvent,
}: SpeedTestOptions = {}): Promise<SpeedTestResult> {
  const base = new URL(baseUrl);
  const measId = createMeasurementId();
  // Latency probes get their own connection so they are not queued behind transfers.
  const transfers = createConnection(base, measId);
  const probes = createConnection(base, measId);
  const raw: RawResults = { latency: [], download: [], upload: [] };
  const skipped: SkippedTransfer[] = [];
  const emit = (event: SpeedTestEvent) => onEvent?.(event, raw);

  const metaRequest = fetchMeta(base, signal).then(
    (meta) => {
      emit({ type: "meta", meta });
      return meta;
    },
    () => undefined,
  );

  // Packet loss uses UDP, so it runs alongside the HTTP measurements without loading the link.
  const packetLossRequest = packetLossOptions
    ? measureAvailablePacketLoss({ ...packetLossOptions, signal }, emit)
    : undefined;

  try {
    const finished = new Set<Direction>();
    for (const measurement of plan) {
      signal?.throwIfAborted();

      if (measurement.type === "latency") {
        for (let i = 0; i < measurement.count; i++) {
          const { ping } = await probes.measure("download", 0, { signal });
          raw.latency.push(ping);
          emit({ type: "latency", ping, progress: { completed: i + 1, total: measurement.count } });
        }
        continue;
      }

      const direction = measurement.type;
      if (finished.has(direction)) {
        continue;
      }

      const group = findOrCreateGroup(raw[direction], measurement.bytes);
      let directionDone: boolean;
      try {
        const minDuration = await measureBandwidth({
          transfers,
          probes,
          direction,
          bytes: measurement.bytes,
          count: measurement.count,
          group,
          signal,
          emit,
        });
        directionDone = !measurement.bypassMinDuration && minDuration > FINISH_REQUEST_DURATION_MS;
      } catch (error) {
        if (signal?.aborted || !(error instanceof Error)) {
          throw error;
        }
        // A failed transfer, typically rate limiting, ends that direction but keeps what was measured.
        const skip = describeSkip(direction, measurement.bytes, error);
        skipped.push(skip);
        emit({ type: "skipped", skipped: skip });
        directionDone = true;
      }
      if (directionDone) {
        finished.add(direction);
        if (finished.size === 2) {
          break;
        }
      }
    }

    const packetLoss = await packetLossRequest;
    signal?.throwIfAborted();
    return { meta: await metaRequest, raw, summary: summarize(raw), skipped, packetLoss };
  } finally {
    transfers.close();
    probes.close();
  }
}

async function measureAvailablePacketLoss(
  options: PacketLossOptions,
  emit: (event: SpeedTestEvent) => void,
): Promise<PacketLossResult | undefined> {
  let packetLoss: PacketLossResult | undefined;
  try {
    const result = await measurePacketLoss(options);
    // No replies at all means UDP is blocked rather than every packet being lost.
    packetLoss = result.received > 0 ? result : undefined;
  } catch {
    packetLoss = undefined;
  }
  if (!options.signal?.aborted) {
    emit({ type: "packetLoss", packetLoss });
  }
  return packetLoss;
}

function describeSkip(direction: Direction, bytes: number, error: Error): SkippedTransfer {
  if (error instanceof HttpError) {
    return {
      direction,
      bytes,
      reason: error.message,
      status: error.status,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  return { direction, bytes, reason: error.message };
}

function findOrCreateGroup(groups: BandwidthGroup[], bytes: number): BandwidthGroup {
  let group = groups.find((candidate) => candidate.bytes === bytes);
  if (!group) {
    group = { bytes, timings: [], loadedLatency: [] };
    groups.push(group);
  }
  return group;
}

interface BandwidthBlock {
  transfers: Connection;
  probes: Connection;
  direction: Direction;
  bytes: number;
  count: number;
  group: BandwidthGroup;
  signal?: AbortSignal;
  emit: (event: SpeedTestEvent) => void;
}

async function measureBandwidth({ transfers, probes, direction, bytes, count, group, signal, emit }: BandwidthBlock) {
  const stopProbing = new AbortController();
  const probing = probeUnderLoad(probes, direction, stopProbing.signal, signal, (ping) => {
    group.loadedLatency.push(ping);
    emit({ type: "latency", ping, during: direction });
  });

  let minDuration = Infinity;
  try {
    for (let i = 0; i < count; i++) {
      let lastProgressAt = -Infinity;
      const onProgress = (progress: TransferProgress) => {
        const now = performance.now();
        if (progress.elapsedMs < PROGRESS_MIN_ELAPSED_MS || now - lastProgressAt < PROGRESS_INTERVAL_MS) {
          return;
        }
        lastProgressAt = now;
        emit({ type: "progress", direction, bytes, progress });
      };
      const timing = await transfers.measure(direction, bytes, { signal, onProgress });
      group.timings.push(timing);
      minDuration = Math.min(minDuration, timing.duration);
      emit({ type: "bandwidth", direction, timing });
    }
  } finally {
    stopProbing.abort();
    await probing;
  }
  return minDuration;
}

async function probeUnderLoad(
  probes: Connection,
  direction: Direction,
  stop: AbortSignal,
  signal: AbortSignal | undefined,
  onPing: (ping: number) => void,
) {
  const throttle = signal ? AbortSignal.any([stop, signal]) : stop;
  try {
    await delay(LOADED_LATENCY_START_DELAY_MS, undefined, { signal: throttle });
    while (!stop.aborted) {
      const { ping } = await probes.measure("download", 0, { during: direction, signal });
      if (stop.aborted) {
        break;
      }
      onPing(ping);
      await delay(LOADED_LATENCY_THROTTLE_MS, undefined, { signal: throttle });
    }
  } catch {
    // Loaded latency is best-effort; transfer failures are surfaced by the caller.
  }
}
