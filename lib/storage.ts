import "server-only";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";

/**
 * Файловое хранилище: Cloudflare R2 через S3 API (прод) или папка .data/uploads (локальная разработка).
 * Клиент никогда не ходит в R2 напрямую — только через /api/files/[id] на нашем домене.
 */
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  readonly kind: "r2" | "local";
}

class R2Storage implements Storage {
  readonly kind = "r2" as const;
  private client = new S3Client({
    region: "auto",
    endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.r2.accessKeyId, secretAccessKey: env.r2.secretAccessKey },
  });

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: env.r2.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: env.r2.bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) return null;
      return { body: Buffer.from(bytes), contentType: res.ContentType ?? "application/octet-stream" };
    } catch (e) {
      if ((e as { name?: string }).name === "NoSuchKey") return null;
      throw e;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: env.r2.bucket, Key: key }));
  }

  async list(prefix: string) {
    const res = await this.client.send(new ListObjectsV2Command({ Bucket: env.r2.bucket, Prefix: prefix, MaxKeys: 1000 }));
    return (res.Contents ?? []).map((o) => o.Key!).filter(Boolean);
  }
}

class LocalStorage implements Storage {
  readonly kind = "local" as const;
  private root = path.join(process.cwd(), ".data", "uploads");

  private resolve(key: string) {
    const safe = key.replace(/\.\./g, "").replace(/^\/+/, "");
    return path.join(this.root, safe);
  }

  async put(key: string, body: Buffer, contentType: string) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    await writeFile(`${file}.meta`, contentType);
  }

  async get(key: string) {
    try {
      const file = this.resolve(key);
      const [body, contentType] = await Promise.all([readFile(file), readFile(`${file}.meta`, "utf8").catch(() => "application/octet-stream")]);
      return { body, contentType };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    const file = this.resolve(key);
    await Promise.allSettled([unlink(file), unlink(`${file}.meta`)]);
  }

  async list(prefix: string) {
    const dir = this.resolve(prefix);
    try {
      const names = await readdir(dir);
      return names.filter((n) => !n.endsWith(".meta")).map((n) => `${prefix.replace(/\/?$/, "/")}${n}`);
    } catch {
      return [];
    }
  }
}

const globalForStorage = globalThis as unknown as { __raspisonStorage?: Storage };

export const storage: Storage = globalForStorage.__raspisonStorage ?? (env.r2.configured ? new R2Storage() : new LocalStorage());
if (process.env.NODE_ENV !== "production") globalForStorage.__raspisonStorage = storage;

export const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
};

/** Лимит тела запроса на Vercel — 4.5 МБ; оставляем запас. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
