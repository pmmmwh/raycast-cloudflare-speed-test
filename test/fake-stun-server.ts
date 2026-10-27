import dgram from "node:dgram";
import type { AddressInfo } from "node:net";
import type { StunServer } from "../src/lib/engine/packet-loss";

export interface FakeStunServerOptions {
  dropEvery?: number;
  silent?: boolean;
}

export interface FakeStunServer {
  server: StunServer;
  requests: () => number;
  close(): Promise<void>;
}

export async function startFakeStunServer({
  dropEvery = 0,
  silent = false,
}: FakeStunServerOptions = {}): Promise<FakeStunServer> {
  const socket = dgram.createSocket("udp4");
  let requests = 0;

  socket.on("message", (message, remote) => {
    requests++;
    if (silent || (dropEvery > 0 && requests % dropEvery === 0)) {
      return;
    }
    const response = Buffer.from(message);
    response.writeUInt16BE(0x0101, 0);
    socket.send(response, remote.port, remote.address);
  });

  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", () => resolve()));
  const { port } = socket.address() as AddressInfo;

  return {
    server: { host: "127.0.0.1", port },
    requests: () => requests,
    close: () => new Promise((resolve) => socket.close(() => resolve())),
  };
}
