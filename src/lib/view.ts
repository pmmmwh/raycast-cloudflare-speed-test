import { PANEL_GAP, PANEL_WIDTH, bandwidthChart, latencyChart, markdownImage, type Theme } from "./charts";
import { formatLatency, formatPercent, formatSpeed } from "./format";
import { headingPair } from "./headings";
import { describeSkipped, type Phase, type RunState } from "./run-state";

const RIGHT_COLUMN_PT = PANEL_WIDTH + PANEL_GAP;

function placeholder(phase: Phase, measuring: boolean): string {
  if (phase === "failed") {
    return "Unavailable";
  }
  return measuring ? "Measuring" : "Pending";
}

export const LATENCY_HEADING = "## Latency Under Load";

export function bandwidthHeading(state: RunState): string {
  const { phase, summary } = state;
  const download = formatSpeed(summary.download) ?? placeholder(phase, phase === "download");
  const upload = formatSpeed(summary.upload) ?? placeholder(phase, phase === "upload");
  return headingPair(`↓ ${download}`, `↑ ${upload}`, RIGHT_COLUMN_PT);
}

export function packetLossValue(state: RunState): string {
  if (state.packetLoss) {
    return formatPercent(state.packetLoss.lossRatio);
  }
  if (state.packetLoss === null || state.phase === "finished") {
    return "Unavailable";
  }
  return placeholder(state.phase, true);
}

export function latencyValue(state: RunState, ms: number | undefined): string {
  const measuring = state.phase === "starting" || state.phase === "latency";
  return formatLatency(ms) ?? placeholder(state.phase, measuring);
}

export function notice(state: RunState): string | undefined {
  if (state.error) {
    return `**The test stopped early:** ${state.error}`;
  }
  return state.phase === "finished" ? describeSkipped(state.skipped) : undefined;
}

// Each frame gets distinct alt text so Raycast does not reuse a previously rendered image.
export function buildMarkdown(state: RunState, theme: Theme, frame: number): string {
  const bandwidthImage = bandwidthChart(
    { samples: state.bandwidthSamples, summary: state.summary, live: state.live },
    theme,
  );
  const latencyImage = latencyChart({ latency: state.latency, summary: state.summary }, theme);
  return [
    bandwidthHeading(state),
    markdownImage(bandwidthImage, `Download and upload speed per request, frame ${frame}`),
    LATENCY_HEADING,
    markdownImage(latencyImage, `Latency idle and under load, frame ${frame}`),
    notice(state),
  ]
    .filter((block) => block != null)
    .join("\n\n");
}
