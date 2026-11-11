import type { Summary } from "./stats";

export type Rating = "bad" | "poor" | "average" | "good" | "great";
export type Experience = "streaming" | "gaming" | "videoCalls";

export interface QualityScore {
  points: number;
  rating: Rating;
}

export type QualityScores = Partial<Record<Experience, QualityScore>>;

type Metric = "latency" | "jitter" | "download" | "upload" | "loadedLatencyIncrease" | "packetLoss";

export const RATINGS: Rating[] = ["bad", "poor", "average", "good", "great"];

function scaleThreshold(domain: number[], range: number[]) {
  return (value: number) => {
    let index = 0;
    while (index < domain.length && value >= domain[index]) {
      index++;
    }
    return range[index];
  };
}

// Point tables from speed.cloudflare.com's network quality score (@cloudflare/speedtest).
const METRIC_POINTS: Record<Metric, (value: number) => number> = {
  packetLoss: scaleThreshold([0.01, 0.05, 0.25, 0.5], [10, 5, 0, -10, -20]),
  latency: scaleThreshold([10, 20, 50, 100, 500], [20, 10, 5, 0, -10, -20]),
  loadedLatencyIncrease: scaleThreshold([10, 20, 50, 100, 500], [20, 10, 5, 0, -10, -20]),
  jitter: scaleThreshold([10, 20, 100, 500], [10, 5, 0, -10, -20]),
  download: scaleThreshold([1e6, 1e7, 5e7, 1e8], [0, 5, 10, 20, 30]),
  upload: scaleThreshold([1e6, 1e7, 5e7, 1e8], [0, 5, 10, 20, 30]),
};

const EXPERIENCES: Record<Experience, { metrics: Metric[]; ratingThresholds: number[] }> = {
  streaming: {
    metrics: ["latency", "packetLoss", "download", "loadedLatencyIncrease"],
    ratingThresholds: [15, 20, 40, 60],
  },
  gaming: { metrics: ["latency", "packetLoss", "loadedLatencyIncrease"], ratingThresholds: [5, 15, 25, 30] },
  videoCalls: {
    metrics: ["latency", "jitter", "packetLoss", "loadedLatencyIncrease"],
    ratingThresholds: [5, 15, 25, 40],
  },
};

export function loadedLatencyIncrease(summary: Summary): number | undefined {
  const loaded = [summary.downLoadedLatency, summary.upLoadedLatency].filter((value) => value != null);
  if (summary.latency == null || loaded.length === 0) {
    return;
  }
  return Math.max(...loaded) - summary.latency;
}

export function scoreQuality(summary: Summary, packetLoss?: number): QualityScores {
  const values: Record<Metric, number | undefined> = {
    latency: summary.latency,
    jitter: summary.jitter,
    download: summary.download,
    upload: summary.upload,
    loadedLatencyIncrease: loadedLatencyIncrease(summary),
    packetLoss,
  };

  const scores: QualityScores = {};
  for (const [experience, { metrics, ratingThresholds }] of Object.entries(EXPERIENCES)) {
    // Packet loss is optional: like Cloudflare, an unmeasured value is left out rather than penalised.
    const measured = metrics.filter((metric) => metric !== "packetLoss" || packetLoss != null);
    if (measured.some((metric) => values[metric] == null)) {
      continue;
    }
    const total = measured.reduce((sum, metric) => sum + METRIC_POINTS[metric](values[metric] as number), 0);
    const points = Math.max(0, total);
    const rating = RATINGS[scaleThreshold(ratingThresholds, [0, 1, 2, 3, 4])(points)];
    scores[experience as Experience] = { points, rating };
  }
  return scores;
}
