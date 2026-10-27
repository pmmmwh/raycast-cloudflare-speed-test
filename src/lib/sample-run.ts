import { setTimeout as delay } from "node:timers/promises";
import type { SkippedTransfer, SpeedTestEvent, SpeedTestOptions, SpeedTestResult } from "./engine/engine";
import type { PacketLossResult } from "./engine/packet-loss";
import { DEFAULT_PLAN } from "./engine/plan";
import type { ConnectionMeta, Direction, RequestTiming } from "./engine/transport";
import { summarize, type BandwidthGroup, type RawResults } from "./stats";

export type SampleScenario = "typical" | "rateLimited" | "udpBlocked" | "failed" | "slow" | "gigabit";
export type SampleStage = "starting" | "latency" | "download" | "upload";

export const SAMPLE_STAGE_TITLES: Record<SampleStage, string> = {
  starting: "Connecting",
  latency: "Measuring Latency",
  download: "Downloading",
  upload: "Uploading",
};

interface ScenarioProfile {
  title: string;
  downloadMbps: number;
  uploadMbps: number;
  idleMs: number;
  loadedDownloadMs: number;
  loadedUploadMs: number;
  packetLossRatio: number | null;
  rateLimitFromBytes?: number;
  failAfterDownload?: boolean;
}

export const SAMPLE_SCENARIOS: Record<SampleScenario, ScenarioProfile> = {
  typical: {
    title: "Typical",
    downloadMbps: 100,
    uploadMbps: 95,
    idleMs: 4.8,
    loadedDownloadMs: 9.8,
    loadedUploadMs: 9.2,
    packetLossRatio: 0,
  },
  rateLimited: {
    title: "Rate Limited",
    downloadMbps: 100,
    uploadMbps: 95,
    idleMs: 4.8,
    loadedDownloadMs: 9.8,
    loadedUploadMs: 9.2,
    packetLossRatio: 0,
    rateLimitFromBytes: 1e7,
  },
  udpBlocked: {
    title: "UDP Blocked",
    downloadMbps: 100,
    uploadMbps: 95,
    idleMs: 4.8,
    loadedDownloadMs: 9.8,
    loadedUploadMs: 9.2,
    packetLossRatio: null,
  },
  failed: {
    title: "Failed",
    downloadMbps: 100,
    uploadMbps: 95,
    idleMs: 4.8,
    loadedDownloadMs: 9.8,
    loadedUploadMs: 9.2,
    packetLossRatio: 0,
    failAfterDownload: true,
  },
  slow: {
    title: "Slow Connection",
    downloadMbps: 8,
    uploadMbps: 1.5,
    idleMs: 62,
    loadedDownloadMs: 340,
    loadedUploadMs: 610,
    packetLossRatio: 0.03,
  },
  gigabit: {
    title: "Gigabit Connection",
    downloadMbps: 940,
    uploadMbps: 880,
    idleMs: 2.1,
    loadedDownloadMs: 3.4,
    loadedUploadMs: 4.2,
    packetLossRatio: 0,
  },
};

const SAMPLE_META: ConnectionMeta = {
  clientIp: "192.0.2.1",
  asn: 64496,
  asOrganization: "Example Network",
  colo: { iata: "ARN", city: "Stockholm" },
};

// Simulated time is compressed so a full sample run plays back in roughly 15 seconds.
const LATENCY_STEP_MS = 60;
const MAX_TRANSFER_STEP_MS = 700;
const PROGRESS_INTERVAL_MS = 100;
const FINISH_REQUEST_DURATION_MS = 1000;
const LOADED_REQUEST_MIN_DURATION_MS = 250;
const LOADED_LATENCY_INTERVAL_MS = 400;
const PACKETS = 1000;

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SampleRunOptions extends Pick<SpeedTestOptions, "signal" | "onEvent"> {
  pace?: number;
  freezeAt?: SampleStage;
}

function reachesStage(event: SpeedTestEvent, stage: SampleStage): boolean {
  switch (stage) {
    case "starting":
      return true;
    case "latency":
      return event.type === "latency" && event.progress?.completed === 10;
    case "download":
    case "upload":
      return event.type === "progress" && event.direction === stage && event.progress.transferred >= event.bytes / 2;
  }
}

function holdUntilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    signal?.throwIfAborted();
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

export function createSampleRunner(
  scenario: SampleScenario,
  defaults: Omit<SampleRunOptions, "signal" | "onEvent"> = {},
) {
  return (options: SampleRunOptions) => runSample(scenario, { ...defaults, ...options });
}

export async function runSample(
  scenario: SampleScenario,
  { signal, onEvent, pace = 1, freezeAt }: SampleRunOptions = {},
): Promise<SpeedTestResult> {
  const profile = SAMPLE_SCENARIOS[scenario];
  const random = seededRandom([...scenario].reduce((sum, char) => sum + char.charCodeAt(0), 0));
  const noise = (spread: number) => 1 + (random() * 2 - 1) * spread;
  const raw: RawResults = { latency: [], download: [], upload: [] };
  const skipped: SkippedTransfer[] = [];
  const finished = new Set<Direction>();
  const emit = async (event: SpeedTestEvent) => {
    onEvent?.(event, raw);
    if (freezeAt && reachesStage(event, freezeAt)) {
      await holdUntilAborted(signal);
    }
  };
  const wait = async (ms: number) => {
    signal?.throwIfAborted();
    if (pace > 0) {
      await delay(ms * pace, undefined, { signal });
    }
  };
  const packetLoss: PacketLossResult | undefined =
    profile.packetLossRatio === null
      ? undefined
      : {
          sent: PACKETS,
          received: Math.round(PACKETS * (1 - profile.packetLossRatio)),
          lossRatio: profile.packetLossRatio,
        };

  if (freezeAt === "starting") {
    await holdUntilAborted(signal);
  }
  await emit({ type: "meta", meta: SAMPLE_META });
  let packetLossReported = false;

  for (const measurement of DEFAULT_PLAN) {
    signal?.throwIfAborted();

    if (measurement.type === "latency") {
      for (let i = 0; i < measurement.count; i++) {
        await wait(LATENCY_STEP_MS);
        const ping = profile.idleMs * noise(0.15);
        raw.latency.push(ping);
        await emit({ type: "latency", ping, progress: { completed: i + 1, total: measurement.count } });
      }
      if (!packetLossReported && raw.latency.length >= 20) {
        packetLossReported = true;
        await emit({ type: "packetLoss", packetLoss });
      }
      continue;
    }

    const direction = measurement.type;
    if (finished.has(direction)) {
      continue;
    }
    if (profile.failAfterDownload && direction === "upload") {
      throw new Error("Latency check failed: network is unreachable");
    }
    if (profile.rateLimitFromBytes != null && measurement.bytes >= profile.rateLimitFromBytes) {
      const skip: SkippedTransfer = {
        direction,
        bytes: measurement.bytes,
        reason: `${direction} of ${measurement.bytes} bytes failed with HTTP 429`,
        status: 429,
        retryAfterSeconds: 3116,
      };
      skipped.push(skip);
      await emit({ type: "skipped", skipped: skip });
      finished.add(direction);
      continue;
    }

    let group = raw[direction].find((candidate) => candidate.bytes === measurement.bytes);
    if (!group) {
      group = { bytes: measurement.bytes, timings: [], loadedLatency: [] } satisfies BandwidthGroup;
      raw[direction].push(group);
    }

    let minDuration = Infinity;
    for (let i = 0; i < measurement.count; i++) {
      const targetBps = (direction === "download" ? profile.downloadMbps : profile.uploadMbps) * 1e6 * noise(0.08);
      const ping = profile.idleMs * noise(0.2);
      const duration = ping + (measurement.bytes * 8 * 1000) / targetBps;
      const loadedMs = direction === "download" ? profile.loadedDownloadMs : profile.loadedUploadMs;
      const steps = Math.max(1, Math.round(Math.min(duration, MAX_TRANSFER_STEP_MS) / PROGRESS_INTERVAL_MS));

      for (let step = 1; step <= steps; step++) {
        await wait(PROGRESS_INTERVAL_MS);
        if (duration >= 300) {
          const progress = {
            transferred: (measurement.bytes * step) / steps,
            elapsedMs: (duration * step) / steps,
            bps: targetBps,
          };
          await emit({ type: "progress", direction, bytes: measurement.bytes, progress });
        }
      }
      if (duration >= LOADED_REQUEST_MIN_DURATION_MS) {
        for (let probe = 0; probe < Math.floor(duration / LOADED_LATENCY_INTERVAL_MS); probe++) {
          const loadedPing = loadedMs * noise(0.3);
          group.loadedLatency.push(loadedPing);
          await emit({ type: "latency", ping: loadedPing, during: direction });
        }
      }

      const timing: RequestTiming = {
        bytes: measurement.bytes,
        ttfb: ping,
        serverTime: 0,
        ping,
        duration,
        bps: (measurement.bytes * 8 * 1.005) / (duration / 1000),
      };
      group.timings.push(timing);
      minDuration = Math.min(minDuration, duration);
      await emit({ type: "bandwidth", direction, timing });
    }

    if (!measurement.bypassMinDuration && minDuration > FINISH_REQUEST_DURATION_MS) {
      finished.add(direction);
      if (finished.size === 2) {
        break;
      }
    }
  }

  return { meta: SAMPLE_META, raw, summary: summarize(raw), skipped, packetLoss };
}
