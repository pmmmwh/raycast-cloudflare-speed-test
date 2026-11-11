import type { RequestTiming } from "./engine/transport";

export interface BandwidthGroup {
  bytes: number;
  timings: RequestTiming[];
  loadedLatency: number[];
}

export interface RawResults {
  latency: number[];
  download: BandwidthGroup[];
  upload: BandwidthGroup[];
}

export interface Summary {
  download?: number;
  upload?: number;
  latency?: number;
  jitter?: number;
  downLoadedLatency?: number;
  downLoadedJitter?: number;
  upLoadedLatency?: number;
  upLoadedJitter?: number;
}

const LATENCY_PERCENTILE = 0.5;
const BANDWIDTH_PERCENTILE = 0.9;
const BANDWIDTH_MIN_REQUEST_DURATION_MS = 10;
const LOADED_REQUEST_MIN_DURATION_MS = 250;
const LOADED_LATENCY_MAX_POINTS = 20;

export function percentile(values: number[], fraction: number): number | undefined {
  if (values.length === 0) {
    return;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const lower = sorted[Math.floor(index)];
  const upper = sorted[Math.ceil(index)];
  return lower + (upper - lower) * (index % 1);
}

export function jitter(values: number[]): number | undefined {
  if (values.length < 2) {
    return;
  }
  let totalDelta = 0;
  for (let i = 1; i < values.length; i++) {
    totalDelta += Math.abs(values[i] - values[i - 1]);
  }
  return totalDelta / (values.length - 1);
}

export function bandwidth(groups: BandwidthGroup[]): number | undefined {
  const samples = groups
    .flatMap((group) => group.timings)
    .filter((timing) => timing.duration >= BANDWIDTH_MIN_REQUEST_DURATION_MS && timing.bps)
    .map((timing) => timing.bps as number);
  return percentile(samples, BANDWIDTH_PERCENTILE);
}

// Short transfers barely load the link, so probes taken during them would understate the latency increase.
export function loadedLatencies(groups: BandwidthGroup[]): number[] {
  return groups
    .filter(
      (group) =>
        group.timings.length > 0 &&
        Math.min(...group.timings.map((timing) => timing.duration)) >= LOADED_REQUEST_MIN_DURATION_MS,
    )
    .flatMap((group) => group.loadedLatency)
    .slice(-LOADED_LATENCY_MAX_POINTS);
}

export function summarize(raw: RawResults): Summary {
  const downLoaded = loadedLatencies(raw.download);
  const upLoaded = loadedLatencies(raw.upload);
  return {
    download: bandwidth(raw.download),
    upload: bandwidth(raw.upload),
    latency: percentile(raw.latency, LATENCY_PERCENTILE),
    jitter: jitter(raw.latency),
    downLoadedLatency: percentile(downLoaded, LATENCY_PERCENTILE),
    downLoadedJitter: jitter(downLoaded),
    upLoadedLatency: percentile(upLoaded, LATENCY_PERCENTILE),
    upLoadedJitter: jitter(upLoaded),
  };
}
