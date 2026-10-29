import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  OUTPUT_MAX_EDGE,
  processImage,
  sniffImage,
} from "./image";

const solid = (width: number, height: number) =>
  sharp({
    create: { width, height, channels: 3, background: { r: 18, g: 99, b: 79 } },
  });

describe("image intake (ADR 0006)", () => {
  it("identifies images by signature, not by name or declared type", async () => {
    expect(sniffImage(await solid(4, 4).jpeg().toBuffer())).toBe("jpeg");
    expect(sniffImage(await solid(4, 4).png().toBuffer())).toBe("png");
    expect(sniffImage(await solid(4, 4).webp().toBuffer())).toBe("webp");
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    );
    expect(sniffImage(svg)).toBeNull();
    expect(sniffImage(await solid(4, 4).gif().toBuffer())).toBeNull();
    expect(sniffImage(Buffer.from("MZ\x90\x00 not an image"))).toBeNull();
  });

  it("re-encodes to bounded WebP and drops every metadata block, GPS included", async () => {
    const withGps = await solid(2400, 1600)
      .jpeg()
      .withExif({
        IFD0: { Make: "PhoneMaker", Model: "Secret device" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "4/1 3/1 0/1" },
      })
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();
    const outcome = await processImage(withGps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const meta = await sharp(outcome.data).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(outcome.width, outcome.height)).toBe(OUTPUT_MAX_EDGE);
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(outcome.data.includes(Buffer.from("Secret device"))).toBe(false);
  });

  it("applies the camera orientation before stripping it", async () => {
    const rotated = await solid(300, 100)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const outcome = await processImage(rotated);
    expect(outcome.ok && [outcome.width, outcome.height]).toEqual([100, 300]);
  });

  it("never enlarges small images", async () => {
    const outcome = await processImage(await solid(320, 200).png().toBuffer());
    expect(outcome.ok && [outcome.width, outcome.height]).toEqual([320, 200]);
  });

  it("rejects oversized files, decompression bombs and corrupt data", async () => {
    expect(
      await processImage(Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0xff)),
    ).toEqual({
      ok: false,
      reason: "too_large",
    });
    // Petit fichier PNG, mais 50 000 x 1 000 pixels une fois décodé.
    const bomb = await solid(50_000, 1_000)
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.byteLength).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(await processImage(bomb)).toEqual({
      ok: false,
      reason: "too_many_pixels",
    });
    const truncated = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(64, 7),
    ]);
    expect(await processImage(truncated)).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });
});
