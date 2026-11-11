import type { LatencyProgress, SkippedTransfer, SpeedTestEvent, SpeedTestResult } from "./engine/engine";
import type { PacketLossResult } from "./engine/packet-loss";
import type { ConnectionMeta, Direction } from "./engine/transport";
import { formatBytes, formatDuration } from "./format";
import { scoreQuality, type QualityScores } from "./scores";
import { loadedLatencies, summarize, type RawResults, type Summary } from "./stats";

export type Phase = "starting" | "latency" | Direction | "finished" | "failed";

export interface BandwidthSample {
  direction: Direction;
  bytes: number;
  bps: number;
  durationMs: number;
}

export interface LiveTransfer {
  direction: Direction;
  bytes: number;
  transferred: number;
  elapsedMs: number;
  bps: number;
}

export interface LatencySamples {
  idle: number[];
  download: number[];
  upload: number[];
}

export interface RunState {
  phase: Phase;
  summary: Summary;
  bandwidthSamples: BandwidthSample[];
  latency: LatencySamples;
  meta?: ConnectionMeta;
  live?: LiveTransfer;
  latencyProgress?: LatencyProgress;
  skipped: SkippedTransfer[];
  // Undefined while measuring; null when it could not be measured.
  packetLoss?: PacketLossResult | null;
  scores?: QualityScores;
  result?: SpeedTestResult;
  durationMs?: number;
  error?: string;
}

export function initialRunState(): RunState {
  return {
    phase: "starting",
    summary: {},
    bandwidthSamples: [],
    latency: { idle: [], download: [], upload: [] },
    skipped: [],
  };
}

function measurements(raw: RawResults): Pick<RunState, "summary" | "latency"> {
  return {
    summary: summarize(raw),
    latency: {
      idle: [...raw.latency],
      download: loadedLatencies(raw.download),
      upload: loadedLatencies(raw.upload),
    },
  };
}

export function applyEvent(state: RunState, event: SpeedTestEvent, raw: RawResults): RunState {
  switch (event.type) {
    case "meta":
      return { ...state, meta: event.meta };
    case "latency":
      return {
        ...state,
        ...measurements(raw),
        phase: event.during ?? "latency",
        live: event.during ? state.live : undefined,
        latencyProgress: event.progress ?? state.latencyProgress,
      };
    case "skipped":
      return { ...state, live: undefined, skipped: [...state.skipped, event.skipped] };
    case "packetLoss":
      return { ...state, packetLoss: event.packetLoss ?? null };
    case "progress":
      return {
        ...state,
        phase: event.direction,
        live: { direction: event.direction, bytes: event.bytes, ...event.progress },
      };
    case "bandwidth":
      return {
        ...state,
        ...measurements(raw),
        phase: event.direction,
        live: undefined,
        bandwidthSamples:
          event.timing.bps == null
            ? state.bandwidthSamples
            : [
                ...state.bandwidthSamples,
                {
                  direction: event.direction,
                  bytes: event.timing.bytes,
                  bps: event.timing.bps,
                  durationMs: event.timing.duration,
                },
              ],
      };
  }
}

export function finishRun(state: RunState, result: SpeedTestResult, durationMs: number): RunState {
  return {
    ...state,
    ...measurements(result.raw),
    phase: "finished",
    meta: result.meta ?? state.meta,
    live: undefined,
    scores: scoreQuality(result.summary, result.packetLoss?.lossRatio),
    skipped: result.skipped,
    packetLoss: result.packetLoss ?? null,
    result,
    durationMs,
  };
}

export function failRun(state: RunState, error: unknown): RunState {
  return {
    ...state,
    phase: "failed",
    live: undefined,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function isRunning(state: RunState): boolean {
  return state.phase !== "finished" && state.phase !== "failed";
}

export function describeStatus(state: RunState): string {
  switch (state.phase) {
    case "starting":
      return "Connecting";
    case "latency": {
      const progress = state.latencyProgress;
      return progress ? `Measuring latency (${progress.completed} of ${progress.total})` : "Measuring latency";
    }
    case "download":
    case "upload": {
      const action = state.phase === "download" ? "Downloading" : "Uploading";
      const live = state.live?.direction === state.phase ? state.live : undefined;
      if (!live) {
        return `Measuring ${state.phase}`;
      }
      const percent = Math.min(100, Math.round((live.transferred / live.bytes) * 100));
      return `${action} ${formatBytes(live.bytes)} (${percent}%)`;
    }
    case "finished": {
      const finished = state.skipped.length > 0 ? "Finished early" : "Finished";
      return state.durationMs == null ? finished : `${finished} in ${formatDuration(state.durationMs)}`;
    }
    case "failed":
      return "Failed";
  }
}

export function describeSkipped(skipped: SkippedTransfer[]): string | undefined {
  if (skipped.length === 0) {
    return;
  }
  const directions = [...new Set(skipped.map((skip) => skip.direction))].join(" and ");
  const rateLimited = skipped.filter((skip) => skip.status === 429);
  if (rateLimited.length === 0) {
    return `The ${directions} test stopped early after a transfer failed (${skipped[0].reason}), so results may be less accurate.`;
  }
  const waitSeconds = Math.max(...rateLimited.map((skip) => skip.retryAfterSeconds ?? 0));
  const retry = waitSeconds > 0 ? ` Try again in about ${Math.ceil(waitSeconds / 60)} min for a full result.` : "";
  return `Cloudflare is rate limiting large transfers from this network, so the ${directions} test stopped early and results may be less accurate.${retry}`;
}
