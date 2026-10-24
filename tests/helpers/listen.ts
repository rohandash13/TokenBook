import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";

export interface Listening {
  url: string;
  host: string;
  close(): Promise<void>;
}

/** Listen on an ephemeral port on 127.0.0.1. */
export function listen(app: Express): Promise<Listening> {
  return new Promise((resolve, reject) => {
    const server: Server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        host: `127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
    server.on("error", reject);
  });
}
