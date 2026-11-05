import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { del, head, put } from "@vercel/blob";

export interface StoredObject {
  key: string;
  byteSize: number;
  contentType: string;
}

export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject>;
  head(key: string): Promise<StoredObject | null>;
  getDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export class MemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  async put(key: string, body: Uint8Array, contentType: string) {
    this.objects.set(key, { body: new Uint8Array(body), contentType });
    return { key, byteSize: body.byteLength, contentType };
  }

  async head(key: string) {
    const object = this.objects.get(key);
    return object ? { key, byteSize: object.body.byteLength, contentType: object.contentType } : null;
  }

  async getDownloadUrl(key: string) {
    if (!this.objects.has(key)) throw new Error(`Object not found: ${key}`);
    return `memory://${encodeURIComponent(key)}`;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  get(key: string) {
    return this.objects.get(key)?.body;
  }
}

export class VercelBlobStorage implements ObjectStorage {
  constructor(private readonly token: string) {}

  async put(key: string, body: Uint8Array, contentType: string) {
    await put(key, Buffer.from(body), { access: "public", addRandomSuffix: false, contentType, token: this.token });
    return { key, byteSize: body.byteLength, contentType };
  }

  async head(key: string) {
    try {
      const metadata = await head(key, { token: this.token });
      return { key, byteSize: metadata.size, contentType: metadata.contentType };
    } catch (error) {
      if (error instanceof Error && /not found/i.test(error.message)) return null;
      throw error;
    }
  }

  async getDownloadUrl(key: string) {
    const metadata = await head(key, { token: this.token });
    return metadata.downloadUrl;
  }

  async delete(key: string) {
    await del(key, { token: this.token });
  }
}

export interface S3StorageOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly options: S3StorageOptions) {
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.forcePathStyle !== undefined ? { forcePathStyle: options.forcePathStyle } : {}),
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: key, Body: body, ContentType: contentType }));
    return { key, byteSize: body.byteLength, contentType };
  }

  async head(key: string) {
    try {
      const metadata = await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return { key, byteSize: metadata.ContentLength ?? 0, contentType: metadata.ContentType ?? "application/octet-stream" };
    } catch (error) {
      if (error instanceof Error && (error.name === "NotFound" || error.name === "NoSuchKey")) return null;
      throw error;
    }
  }

  getDownloadUrl(key: string, expiresInSeconds = 900) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.options.bucket, Key: key }), { expiresIn: expiresInSeconds });
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }
}

export const createObjectStorage = (environment: NodeJS.ProcessEnv = process.env): ObjectStorage => {
  const provider = environment.STORAGE_PROVIDER ?? "vercel-blob";
  if (provider === "memory") return new MemoryObjectStorage();
  if (provider === "vercel-blob") {
    if (!environment.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is required");
    return new VercelBlobStorage(environment.BLOB_READ_WRITE_TOKEN);
  }
  if (provider === "s3") {
    if (!environment.S3_BUCKET || !environment.S3_REGION || !environment.S3_ACCESS_KEY_ID || !environment.S3_SECRET_ACCESS_KEY) {
      throw new Error("S3 storage configuration is incomplete");
    }
    return new S3ObjectStorage({
      bucket: environment.S3_BUCKET,
      region: environment.S3_REGION,
      accessKeyId: environment.S3_ACCESS_KEY_ID,
      secretAccessKey: environment.S3_SECRET_ACCESS_KEY,
      ...(environment.S3_ENDPOINT ? { endpoint: environment.S3_ENDPOINT } : {}),
      forcePathStyle: environment.S3_FORCE_PATH_STYLE === "true",
    });
  }
  throw new Error(`Unsupported storage provider: ${provider}`);
};
