import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Port de stockage objet (ADR 0006). L'application ne dépend que de cette interface :
// le serveur S3 (local ou fournisseur de production) reste interchangeable.
export interface PresignedUpload {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
}
export interface ObjectStorage {
  // Envoi direct navigateur -> bucket de quarantaine ; type et taille exacts sont signés.
  presignUpload(
    key: string,
    contentType: string,
    bytes: number,
    expiresInSeconds: number,
  ): Promise<PresignedUpload>;
  getQuarantined(key: string): Promise<Buffer | null>;
  deleteQuarantined(key: string): Promise<void>;
  putPublic(key: string, data: Buffer, contentType: string): Promise<void>;
}

// Implémentation en mémoire : tests et développement sans serveur S3. Jamais en production.
export class MemoryStorage implements ObjectStorage {
  readonly quarantine = new Map<string, Buffer>();
  readonly published = new Map<string, { data: Buffer; contentType: string }>();
  async presignUpload(
    key: string,
    contentType: string,
    bytes: number,
    expiresInSeconds: number,
  ) {
    return {
      url: `memory://quarantine/${key}`,
      method: "PUT" as const,
      headers: { "content-type": contentType, "content-length": String(bytes) },
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }
  async getQuarantined(key: string) {
    return this.quarantine.get(key) ?? null;
  }
  async deleteQuarantined(key: string) {
    this.quarantine.delete(key);
  }
  async putPublic(key: string, data: Buffer, contentType: string) {
    this.published.set(key, { data, contentType });
  }
}

export interface S3Settings {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  quarantineBucket: string;
  publicBucket: string;
  forcePathStyle?: boolean;
}

export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  constructor(private readonly settings: S3Settings) {
    this.client = new S3Client({
      region: settings.region,
      ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
      forcePathStyle: settings.forcePathStyle ?? Boolean(settings.endpoint),
      // Sinon le SDK signe dans l'URL présignée la somme CRC32 d'un corps vide : tout envoi réel
      // est refusé (BadDigest). Intégrité déjà garantie par type et longueur signés + réencodage.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    });
  }
  async presignUpload(
    key: string,
    contentType: string,
    bytes: number,
    expiresInSeconds: number,
  ) {
    const command = new PutObjectCommand({
      Bucket: this.settings.quarantineBucket,
      Key: key,
      ContentType: contentType,
      ContentLength: bytes,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
      // Le type et la longueur font partie de la signature : un autre fichier est refusé par S3.
      signableHeaders: new Set(["content-type", "content-length"]),
    });
    return {
      url,
      method: "PUT" as const,
      headers: { "content-type": contentType, "content-length": String(bytes) },
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    };
  }
  async getQuarantined(key: string) {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.settings.quarantineBucket,
          Key: key,
        }),
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
  async deleteQuarantined(key: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.settings.quarantineBucket,
        Key: key,
      }),
    );
  }
  async putPublic(key: string, data: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.settings.publicBucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  }
}

export function storageFromEnv(
  env: NodeJS.ProcessEnv,
): ObjectStorage | undefined {
  if (
    !env.S3_ACCESS_KEY_ID ||
    !env.S3_SECRET_ACCESS_KEY ||
    !env.S3_QUARANTINE_BUCKET
  )
    return undefined;
  return new S3Storage({
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    region: env.S3_REGION ?? "us-east-1",
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    quarantineBucket: env.S3_QUARANTINE_BUCKET,
    publicBucket: env.S3_PUBLIC_BUCKET ?? env.S3_QUARANTINE_BUCKET,
  });
}
