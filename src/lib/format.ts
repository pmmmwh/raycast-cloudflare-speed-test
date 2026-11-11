export interface Quantity {
  value: string;
  unit: string;
}

export function speedQuantity(bps: number | undefined): Quantity | undefined {
  if (bps == null) {
    return;
  }
  if (bps >= 1e9) {
    const gbps = bps / 1e9;
    return { value: gbps.toFixed(gbps >= 100 ? 0 : 1), unit: "Gbps" };
  }
  if (bps >= 1e6) {
    const mbps = bps / 1e6;
    return { value: mbps.toFixed(mbps >= 100 ? 0 : 1), unit: "Mbps" };
  }
  const kbps = bps / 1e3;
  return { value: kbps.toFixed(kbps >= 100 ? 0 : 1), unit: "Kbps" };
}

export function latencyQuantity(ms: number | undefined): Quantity | undefined {
  if (ms == null) {
    return;
  }
  return { value: ms.toFixed(ms >= 100 ? 0 : 1), unit: "ms" };
}

export function formatQuantity(quantity: Quantity | undefined): string | undefined {
  return quantity && `${quantity.value} ${quantity.unit}`;
}

export const formatSpeed = (bps: number | undefined) => formatQuantity(speedQuantity(bps));
export const formatLatency = (ms: number | undefined) => formatQuantity(latencyQuantity(ms));

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatBytes(bytes: number): string {
  return bytes >= 1e6 ? `${bytes / 1e6} MB` : `${bytes / 1e3} kB`;
}

export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
