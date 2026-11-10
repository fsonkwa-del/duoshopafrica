import { completeMedia, type Database, pendingMedia } from "@duoshop/database";
import {
  makeThumbnail,
  type ObjectStorage,
  processImage,
  type Scanner,
} from "@duoshop/media";

// Un envoi jamais arrivé en quarantaine au-delà de ce délai est abandonné (URL présignée : 5 min).
export const UPLOAD_GRACE_MS = 60 * 60_000;

export interface MediaJobReport {
  ready: number;
  rejected: number;
  waiting: number;
}

// Traitement idempotent : clés publiques déterministes, finalisation seulement depuis PENDING.
// Le fichier de quarantaine n'est supprimé qu'après la finalisation en base.
export async function processPendingMedia(
  db: Database,
  storage: ObjectStorage,
  now = new Date(),
  // Analyse antivirus en quarantaine (lot 8) ; une erreur de clamd laisse la photo en attente.
  scan?: Scanner,
): Promise<MediaJobReport> {
  const report: MediaJobReport = { ready: 0, rejected: 0, waiting: 0 };
  for (const media of await pendingMedia(db)) {
    const upload = await storage.getQuarantined(media.uploadKey);
    if (!upload) {
      if (now.getTime() - media.createdAt.getTime() < UPLOAD_GRACE_MS) {
        report.waiting++;
        continue;
      }
      await completeMedia(db, {
        id: media.id,
        status: "REJECTED",
        reason: "upload_missing",
      });
      report.rejected++;
      continue;
    }
    if (scan && (await scan(upload)) === "infected") {
      await storage.deleteQuarantined(media.uploadKey);
      await completeMedia(db, {
        id: media.id,
        status: "REJECTED",
        reason: "infected",
      });
      report.rejected++;
      continue;
    }
    const outcome = await processImage(upload);
    if (outcome.ok) {
      const publicKey = `products/${media.tenantId}/${media.id}.webp`;
      await storage.putPublic(publicKey, outcome.data, "image/webp");
      // Vignette des grilles (lot 1) : pages acheteur légères en 3G.
      const thumbKey = `products/${media.tenantId}/${media.id}-480.webp`;
      await storage.putPublic(
        thumbKey,
        await makeThumbnail(outcome.data),
        "image/webp",
      );
      await completeMedia(db, {
        id: media.id,
        status: "READY",
        publicKey,
        width: outcome.width,
        height: outcome.height,
        bytes: outcome.bytes,
      });
      await db.productMedia.update({
        where: { id: media.id },
        data: { thumbKey },
      });
      report.ready++;
    } else {
      await completeMedia(db, {
        id: media.id,
        status: "REJECTED",
        reason: outcome.reason,
      });
      report.rejected++;
    }
    await storage.deleteQuarantined(media.uploadKey);
  }
  return report;
}
