import { connect } from "node:net";

// Lot 8 (ADR 0016) : analyse antivirus par clamd (protocole INSTREAM sur TCP), sans dépendance.
// Pièces KYC (avant chiffrement) et photos (en quarantaine, avant traitement).
export type ScanResult = "clean" | "infected";
export type Scanner = (data: Buffer) => Promise<ScanResult>;

const CHUNK = 64 * 1024;

export function clamdScanner(
  host: string,
  port: number,
  timeoutMs = 30_000,
): Scanner {
  return (data) =>
    new Promise((resolve, reject) => {
      const socket = connect({ host, port });
      const replies: Buffer[] = [];
      socket.setTimeout(timeoutMs, () => {
        socket.destroy();
        reject(new Error("clamd timeout"));
      });
      socket.on("error", reject);
      socket.on("data", (chunk) => replies.push(chunk));
      socket.on("end", () => {
        const answer = Buffer.concat(replies)
          .toString("utf8")
          .replace(/\0/g, "")
          .trim();
        // « stream: OK » ou « stream: <signature> FOUND » ; toute autre réponse est une erreur.
        if (/ OK$/.test(answer)) resolve("clean");
        else if (/ FOUND$/.test(answer)) resolve("infected");
        else reject(new Error(`clamd: ${answer || "no answer"}`));
      });
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        for (let i = 0; i < data.length; i += CHUNK) {
          const part = data.subarray(i, i + CHUNK);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(part.length);
          socket.write(size);
          socket.write(part);
        }
        socket.end(Buffer.alloc(4));
      });
    });
}

// CLAMAV_HOST / CLAMAV_PORT ; absent => aucune analyse (signalé par l'appelant).
export function scannerFromEnv(
  env: Record<string, string | undefined>,
): Scanner | undefined {
  if (!env.CLAMAV_HOST) return undefined;
  const port = Number(env.CLAMAV_PORT ?? "3310");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("CLAMAV_PORT must be a TCP port");
  return clamdScanner(env.CLAMAV_HOST, port);
}
