import { describe, expect, it } from "vitest";
import { S3Storage } from "./storage";

describe("S3Storage.presignUpload", () => {
  const storage = new S3Storage({
    endpoint: "https://media.example.invalid",
    region: "us-east-1",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    quarantineBucket: "quarantine",
    publicBucket: "public",
  });

  it("signs type and length, but no checksum of an empty body", async () => {
    const upload = await storage.presignUpload(
      "uploads/a.webp",
      "image/webp",
      1234,
      300,
    );
    const url = new URL(upload.url);
    expect(url.origin).toBe("https://media.example.invalid");
    expect(url.pathname).toBe("/quarantine/uploads/a.webp");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;content-type;host",
    );
    // Une somme signée d'avance ne peut pas correspondre au fichier envoyé (BadDigest).
    expect(
      [...url.searchParams.keys()].filter((k) => /checksum/i.test(k)),
    ).toEqual([]);
  });
});
