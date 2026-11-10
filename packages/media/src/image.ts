import sharp from "sharp";

// ADR 0006 : seuls JPEG, PNG et WebP sont acceptés, identifiés par leur signature binaire
// (jamais par l'extension ou le type déclaré). SVG, GIF, HEIC et le reste sont refusés.
export type AcceptedImage = "jpeg" | "png" | "webp";
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
// Protection contre les « bombes de décompression » : 40 mégapixels au plus.
export const MAX_INPUT_PIXELS = 40_000_000;
export const OUTPUT_MAX_EDGE = 1200;

export function sniffImage(data: Uint8Array): AcceptedImage | null {
  const at = (offset: number, bytes: number[]) =>
    bytes.every((byte, i) => data[offset + i] === byte);
  if (at(0, [0xff, 0xd8, 0xff])) return "jpeg";
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  // RIFF....WEBP
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]))
    return "webp";
  return null;
}

export type ProcessOutcome =
  | { ok: true; data: Buffer; width: number; height: number; bytes: number }
  | {
      ok: false;
      reason:
        | "too_large"
        | "unsupported_type"
        | "unreadable"
        | "too_many_pixels";
    };

// Réencode en WebP : orientation appliquée, taille bornée, AUCUNE métadonnée conservée
// (EXIF, GPS, XMP, ICC hors sRGB) — sharp les supprime tant que withMetadata() n'est pas appelé.
// Vignette des grilles (lot 1, faible débit) : 480 px au plus, depuis l'image déjà réencodée.
export const THUMB_MAX_EDGE = 480;
export async function makeThumbnail(processed: Buffer): Promise<Buffer> {
  return sharp(processed)
    .resize({
      width: THUMB_MAX_EDGE,
      height: THUMB_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 70 })
    .toBuffer();
}

export async function processImage(input: Buffer): Promise<ProcessOutcome> {
  if (input.byteLength > MAX_UPLOAD_BYTES)
    return { ok: false, reason: "too_large" };
  if (!sniffImage(input)) return { ok: false, reason: "unsupported_type" };
  try {
    const meta = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
    if (!meta.width || !meta.height) return { ok: false, reason: "unreadable" };
    const { data, info } = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      pages: 1,
    })
      .rotate()
      .resize({
        width: OUTPUT_MAX_EDGE,
        height: OUTPUT_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      data,
      width: info.width,
      height: info.height,
      bytes: info.size,
    };
  } catch (err) {
    const message = String(err);
    return {
      ok: false,
      reason: /pixel limit/i.test(message) ? "too_many_pixels" : "unreadable",
    };
  }
}
