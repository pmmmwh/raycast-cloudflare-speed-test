import { Action, ActionPanel, Detail } from "@raycast/api";

export const METHODOLOGY_URL = "https://speed.cloudflare.com/about";

const MARKDOWN = `
# About These Metrics

## Download and Upload

How much data your connection moves per second.
The test transfers files of growing size, from 100 kB up to 250 MB for downloads and 50 MB for uploads, and stops growing once a transfer takes longer than a second.
The result is the 90th percentile of all transfers: what your connection reaches near its best, without relying on one lucky transfer.

The chart traces each transfer's speed over the time it took, and the line marks the 90th percentile.
Short transfers can run above your plan's speed if your provider allows brief bursts.

## Latency

How long a tiny request takes to reach Cloudflare and come back while nothing else is running, with Cloudflare's own processing time removed.
The value is the median of about 20 checks. Under 20 ms is excellent; above 100 ms starts to be noticeable in calls and games.

## Latency Under Load

Latency measured while a download or upload is running.
If it climbs well above idle latency, your connection is queueing traffic, which causes lag in calls and games whenever something else is downloading or uploading.
Only checks taken during transfers of at least 250 ms count, up to the 20 most recent.
In the chart, each box spans the middle half of the checks and its line marks the median.

## Jitter

How much latency changes from one check to the next: the average difference between consecutive idle latency checks.
High jitter makes audio and video choppy. Under 10 ms is good.

## Packet Loss

The share of 1000 small UDP packets sent to Cloudflare's STUN server that never came back.
Any loss hurts real-time apps like calls and games; under 1% is good.
"Unavailable" means nothing came back at all, which usually means the network blocks UDP.

## Network Quality Ratings

Streaming, Gaming and Video Calls are rated with Cloudflare's scoring.
Each metric earns points, the points are added up per activity, and the total maps to Bad, Poor, Average, Good or Great.

- **Streaming:** download speed, latency, latency under load and packet loss.
- **Gaming:** latency, latency under load and packet loss.
- **Video Calls:** latency, jitter, latency under load and packet loss.

## Server

The Cloudflare data center that handled the test, usually the one closest to you.
`;

export function MetricsExplainer() {
  return (
    <Detail
      navigationTitle="About These Metrics"
      markdown={MARKDOWN}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser title="Open Cloudflare's Methodology" url={METHODOLOGY_URL} />
        </ActionPanel>
      }
    />
  );
}
