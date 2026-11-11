import { formatDuration, formatLatency, formatPercent, formatSpeed } from "./format";
import type { RunState } from "./run-state";
import { RATINGS, type Experience, type Rating } from "./scores";

export const EXPERIENCE_TITLES: Record<Experience, string> = {
  streaming: "Streaming",
  gaming: "Gaming",
  videoCalls: "Video Calls",
};

export const RATING_TITLES: Record<Rating, string> = {
  bad: "Bad",
  poor: "Poor",
  average: "Average",
  good: "Good",
  great: "Great",
};

const STAR_COUNT = 5;

export function ratingStars(rating: Rating): string {
  const filled = RATINGS.indexOf(rating) + 1;
  return "★".repeat(filled) + "☆".repeat(STAR_COUNT - filled);
}

export function serverLocation(state: RunState): string | undefined {
  const colo = state.meta?.colo;
  if (!colo?.iata) {
    return;
  }
  return colo.city ? `${colo.city} (${colo.iata})` : colo.iata;
}

export function networkName(state: RunState): string | undefined {
  const { asOrganization, asn } = state.meta ?? {};
  if (!asOrganization) {
    return asn == null ? undefined : `AS${asn}`;
  }
  return asn == null ? asOrganization : `${asOrganization} (AS${asn})`;
}

export function textReport(state: RunState): string {
  const { summary, scores } = state;
  const lines: [string, string | undefined][] = [
    ["Download", formatSpeed(summary.download)],
    ["Upload", formatSpeed(summary.upload)],
    ["Latency", formatLatency(summary.latency)],
    ["Jitter", formatLatency(summary.jitter)],
    ["Packet loss", state.packetLoss ? formatPercent(state.packetLoss.lossRatio) : undefined],
    ["Latency while downloading", formatLatency(summary.downLoadedLatency)],
    ["Latency while uploading", formatLatency(summary.upLoadedLatency)],
    ...Object.entries(EXPERIENCE_TITLES).map(([experience, title]): [string, string | undefined] => {
      const score = scores?.[experience as Experience];
      return [title, score && RATING_TITLES[score.rating]];
    }),
    ["Server", serverLocation(state)],
    ["Network", networkName(state)],
    ["Duration", state.durationMs == null ? undefined : formatDuration(state.durationMs)],
  ];
  return [
    "Cloudflare Speed Test",
    ...lines.filter(([, value]) => value != null).map(([label, value]) => `${label}: ${value}`),
  ].join("\n");
}

export function jsonReport(state: RunState): string {
  return JSON.stringify(
    {
      summary: state.summary,
      scores: state.scores,
      packetLoss: state.packetLoss ?? undefined,
      meta: state.meta,
      durationMs: state.durationMs,
      raw: state.result?.raw,
    },
    null,
    2,
  );
}
