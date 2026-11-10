import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// Coffre des pièces KYC (lot 5, ADR 0013) : espace séparé des photos, identifiants propres, aucune
// lecture publique. Chaque pièce est chiffrée par enveloppe avant envoi : une clé de données par
// pièce (AES-256-GCM), elle-même chiffrée par la clé maîtresse KYC versionnée, gardée hors base.
export interface PrivateVault {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export class MemoryVault implements PrivateVault {
  readonly objects = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.objects.set(key, Buffer.from(data));
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

export class S3Vault implements PrivateVault {
  private readonly client: S3Client;
  constructor(
    private readonly bucket: string,
    settings: {
      endpoint?: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
    },
  ) {
    this.client = new S3Client({
      region: settings.region,
      ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
      forcePathStyle: Boolean(settings.endpoint),
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    });
  }
  async put(key: string, data: Buffer) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: "application/octet-stream",
      }),
    );
  }
  async get(key: string) {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const bytes = await response.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        "name" in err &&
        err.name === "NoSuchKey"
      )
        return null;
      throw err;
    }
  }
  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

export interface KycKeys {
  keys: ReadonlyMap<number, Buffer>;
  currentVersion: number;
}

// KYC_S3_* (identifiants distincts de ceux des photos), KYC_MASTER_KEY_<n> en base64 (32 octets),
// KYC_MASTER_KEY_VERSION. Absent => dépôt de pièces indisponible (refus explicite).
export function vaultFromEnv(
  env: Record<string, string | undefined>,
): { vault: PrivateVault; keys: KycKeys } | undefined {
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    const match = /^KYC_MASTER_KEY_(\d+)$/.exec(name);
    if (!match || !value) continue;
    const key = Buffer.from(value, "base64");
    if (key.length !== 32)
      throw new Error(`${name} must be 32 bytes encoded in base64`);
    keys.set(Number(match[1]), key);
  }
  if (
    !env.KYC_S3_BUCKET ||
    !env.KYC_S3_ACCESS_KEY_ID ||
    !env.KYC_S3_SECRET_ACCESS_KEY
  )
    return undefined;
  const currentVersion = Number(env.KYC_MASTER_KEY_VERSION ?? "1");
  if (!keys.has(currentVersion))
    throw new Error(
      `KYC_MASTER_KEY_${currentVersion} is required with KYC_S3_BUCKET`,
    );
  // Les identifiants des photos ne doivent jamais ouvrir le coffre KYC.
  if (env.KYC_S3_ACCESS_KEY_ID === env.S3_ACCESS_KEY_ID)
    throw new Error("KYC_S3_ACCESS_KEY_ID must differ from S3_ACCESS_KEY_ID");
  return {
    vault: new S3Vault(env.KYC_S3_BUCKET, {
      ...(env.KYC_S3_ENDPOINT ? { endpoint: env.KYC_S3_ENDPOINT } : {}),
      region: env.KYC_S3_REGION ?? "us-east-1",
      accessKeyId: env.KYC_S3_ACCESS_KEY_ID,
      secretAccessKey: env.KYC_S3_SECRET_ACCESS_KEY,
    }),
    keys: { keys, currentVersion },
  };
}

const gcm = (key: Buffer, data: Buffer) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
};
const ungcm = (key: Buffer, sealed: Buffer) => {
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([
    decipher.update(sealed.subarray(28)),
    decipher.final(),
  ]);
};

// Chiffrement par enveloppe : renvoie l'objet chiffré, la clé de données chiffrée et l'empreinte
// du clair (contrôle d'intégrité à la relecture).
export function sealDocument(
  data: Buffer,
  keys: KycKeys,
): { sealed: Buffer; wrappedKey: Buffer; keyVersion: number; sha256: string } {
  const master = keys.keys.get(keys.currentVersion);
  if (!master) throw new Error("No KYC master key");
  const dataKey = randomBytes(32);
  return {
    sealed: gcm(dataKey, data),
    wrappedKey: gcm(master, dataKey),
    keyVersion: keys.currentVersion,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}
export function openDocument(
  sealed: Buffer,
  wrappedKey: Buffer,
  keyVersion: number,
  keys: KycKeys,
): Buffer {
  const master = keys.keys.get(keyVersion);
  if (!master) throw new Error(`KYC master key ${keyVersion} is missing`);
  return ungcm(ungcm(master, wrappedKey), sealed);
}
// Rotation : la clé de données est rechiffrée avec la clé maîtresse courante, l'objet ne bouge pas.
export function rewrapKey(
  wrappedKey: Buffer,
  keyVersion: number,
  keys: KycKeys,
): { wrappedKey: Buffer; keyVersion: number } {
  const old = keys.keys.get(keyVersion);
  const current = keys.keys.get(keys.currentVersion);
  if (!old || !current) throw new Error("KYC master key missing");
  return {
    wrappedKey: gcm(current, ungcm(old, wrappedKey)),
    keyVersion: keys.currentVersion,
  };
}

// Type réel du fichier d'après ses premiers octets (jamais d'après le nom ou l'en-tête HTTP).
export function sniffDocumentType(
  data: Buffer,
): "image/jpeg" | "image/png" | "application/pdf" | null {
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    return "image/jpeg";
  if (
    data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (data.subarray(0, 5).toString("latin1") === "%PDF-")
    return "application/pdf";
  return null;
}
