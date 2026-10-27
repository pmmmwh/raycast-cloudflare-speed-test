import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatBytes, formatDuration, formatLatency, formatSpeed, speedQuantity } from "../src/lib/format";

describe("formatSpeed", () => {
  it("shows one decimal below 100 Mbps", () => {
    assert.equal(formatSpeed(9.87e6), "9.9 Mbps");
    assert.equal(formatSpeed(97.66e6), "97.7 Mbps");
  });

  it("drops decimals from 100 Mbps", () => {
    assert.equal(formatSpeed(131.6e6), "132 Mbps");
  });

  it("switches to Gbps from 1000 Mbps", () => {
    assert.deepEqual(speedQuantity(1.2345e9), { value: "1.23", unit: "Gbps" });
  });

  it("is undefined without a value", () => {
    assert.equal(formatSpeed(undefined), undefined);
  });
});

describe("formatLatency", () => {
  it("shows one decimal below 100 ms", () => {
    assert.equal(formatLatency(4.94), "4.9 ms");
    assert.equal(formatLatency(0), "0.0 ms");
  });

  it("drops decimals from 100 ms", () => {
    assert.equal(formatLatency(237.4), "237 ms");
  });
});

describe("formatBytes", () => {
  it("uses kB below a megabyte and MB from there", () => {
    assert.equal(formatBytes(1e5), "100 kB");
    assert.equal(formatBytes(25e6), "25 MB");
  });
});

describe("formatDuration", () => {
  it("shows seconds with one decimal", () => {
    assert.equal(formatDuration(33_240), "33.2 s");
  });
});
