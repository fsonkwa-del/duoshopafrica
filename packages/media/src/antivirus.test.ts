import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { clamdScanner, scannerFromEnv } from "./antivirus";

// Faux clamd : lit les blocs INSTREAM, répond FOUND si le flux contient le marqueur de test.
let server: Server | undefined;
function fakeClamd(): Promise<number> {
  server = createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on("data", (c) => chunks.push(c));
    socket.on("end", () => {
      const infected = Buffer.concat(chunks).includes(
        Buffer.from("TEST-VIRUS"),
      );
      socket.end(infected ? "stream: Test-Signature FOUND\0" : "stream: OK\0");
    });
  });
  return new Promise((resolve) =>
    server?.listen(0, "127.0.0.1", () => {
      const address = server?.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    }),
  );
}
afterEach(() => server?.close());

describe("clamd scanner (INSTREAM)", () => {
  it("reports clean and infected streams", async () => {
    const scan = clamdScanner("127.0.0.1", await fakeClamd());
    expect(await scan(Buffer.alloc(200_000, 1))).toBe("clean");
    expect(await scan(Buffer.from("xx TEST-VIRUS xx"))).toBe("infected");
  });
  it("fails when clamd is unreachable rather than letting the file through", async () => {
    await expect(
      clamdScanner("127.0.0.1", 1, 1000)(Buffer.from("a")),
    ).rejects.toThrow();
  });
  it("is configured from the environment only when a host is set", () => {
    expect(scannerFromEnv({})).toBeUndefined();
    expect(() =>
      scannerFromEnv({ CLAMAV_HOST: "clamav", CLAMAV_PORT: "x" }),
    ).toThrow();
  });
});
