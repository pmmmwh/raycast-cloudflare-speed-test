import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { headingPair, headingWidth } from "../src/lib/headings";

const NBSP = String.fromCharCode(0xa0);

describe("headingWidth", () => {
  // Widths measured from a Raycast screenshot at 1×.
  it("estimates rendered heading widths within a few points", () => {
    assert.ok(Math.abs(headingWidth("Latency 4.8 ms") - 146.5) < 6);
    assert.ok(Math.abs(headingWidth("↓ 136 Mbps") - 113.5) < 6);
  });

  it("grows with longer values", () => {
    assert.ok(headingWidth("↓ 1.23 Gbps") > headingWidth("↓ 9.9 Mbps"));
  });
});

describe("headingPair", () => {
  it("pads the left heading out to the right column", () => {
    const pair = headingPair("↓ 136 Mbps", "↑ 99.8 Mbps", 235);
    const spaces = pair.match(new RegExp(NBSP, "g"))?.length ?? 0;
    assert.match(pair, new RegExp(`^## ↓ 136 Mbps${NBSP}+↑ 99\\.8 Mbps$`));
    assert.ok(Math.abs(headingWidth("↓ 136 Mbps") + spaces * 0.268 * 20.5 - 235) < 3);
  });

  it("keeps a minimum gap when the left heading is too wide", () => {
    const pair = headingPair("Latency Unavailable", "Jitter Unavailable", 100);
    assert.equal(pair, `## Latency Unavailable${NBSP}${NBSP}Jitter Unavailable`);
  });
});
