import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LIGHT_THEME } from "../src/lib/charts";
import { failRun, initialRunState, type RunState } from "../src/lib/run-state";
import {
  LATENCY_HEADING,
  bandwidthHeading,
  buildMarkdown,
  latencyValue,
  notice,
  packetLossValue,
} from "../src/lib/view";

const NBSP = String.fromCharCode(0xa0);
const plain = (heading: string) => heading.replace(new RegExp(`${NBSP}+`, "g"), " | ");

function finished(overrides: Partial<RunState> = {}): RunState {
  return {
    ...initialRunState(),
    phase: "finished",
    summary: { download: 136e6, upload: 99.8e6, latency: 4.8, jitter: 0.5 },
    ...overrides,
  };
}

describe("bandwidthHeading", () => {
  it("shows what is being measured before results arrive", () => {
    assert.equal(plain(bandwidthHeading(initialRunState())), "## ↓ Pending | ↑ Pending");
  });

  it("marks the active direction as measuring", () => {
    const state: RunState = { ...initialRunState(), phase: "upload", summary: { download: 136e6 } };
    assert.equal(plain(bandwidthHeading(state)), "## ↓ 136 Mbps | ↑ Measuring");
  });

  it("shows results once finished", () => {
    assert.equal(plain(bandwidthHeading(finished())), "## ↓ 136 Mbps | ↑ 99.8 Mbps");
  });

  it("marks missing results as unavailable after a failure", () => {
    assert.equal(
      plain(bandwidthHeading(failRun(initialRunState(), new Error("offline")))),
      "## ↓ Unavailable | ↑ Unavailable",
    );
  });
});

describe("latencyValue", () => {
  it("shows measuring while latency is being probed, then the value", () => {
    assert.equal(latencyValue(initialRunState(), undefined), "Measuring");
    assert.equal(latencyValue({ ...initialRunState(), phase: "download" }, undefined), "Pending");
    assert.equal(latencyValue(finished(), 4.8), "4.8 ms");
  });
});

describe("packetLossValue", () => {
  it("shows measuring, the loss, or unavailable", () => {
    assert.equal(packetLossValue(initialRunState()), "Measuring");
    assert.equal(
      packetLossValue({ ...initialRunState(), packetLoss: { sent: 1000, received: 997, lossRatio: 0.003 } }),
      "0.3%",
    );
    assert.equal(packetLossValue({ ...initialRunState(), packetLoss: null }), "Unavailable");
    assert.equal(packetLossValue(finished()), "Unavailable");
  });
});

describe("notice", () => {
  it("explains failures and skipped transfers, and stays quiet otherwise", () => {
    assert.equal(notice(finished()), undefined);
    assert.equal(notice(failRun(initialRunState(), new Error("offline"))), "**The test stopped early:** offline");
    const skipped = finished({ skipped: [{ direction: "download", bytes: 1e7, reason: "HTTP 429", status: 429 }] });
    assert.match(notice(skipped) ?? "", /rate limiting/);
  });
});

describe("buildMarkdown", () => {
  it("stacks the headings and charts, with frame-specific alt text", () => {
    const markdown = buildMarkdown(finished(), LIGHT_THEME, 7);
    const blocks = markdown.split("\n\n");
    assert.equal(blocks.length, 4);
    assert.match(blocks[0], /^## ↓ 136 Mbps/);
    assert.match(blocks[1], /^!\[Download and upload speed per request, frame 7\]\(data:image\/svg\+xml;base64,/);
    assert.equal(blocks[2], LATENCY_HEADING);
    assert.match(blocks[3], /^!\[Latency idle and under load, frame 7\]/);
  });

  it("appends the notice when there is one", () => {
    const markdown = buildMarkdown(failRun(initialRunState(), new Error("offline")), LIGHT_THEME, 1);
    assert.match(markdown.split("\n\n").at(-1) ?? "", /^\*\*The test stopped early:\*\* offline$/);
  });
});
