import type { StorageService } from './index.js'

interface S3Config {
  endpoint: string
  bucket: string
  accessKey: string
  secretKey: string
}

// Prod driver for MinIO/S3. The AWS SDK is loaded lazily so dev installs
// (STORAGE_DRIVER=local) never need it.
export class S3StorageDriver implements StorageService {
  private clientPromise: Promise<any> | null = null

  constructor(private cfg: S3Config) {}

  private async client() {
    if (!this.clientPromise) {
      this.clientPromise = import('@aws-sdk/client-s3').then(
        (m) =>
          new m.S3Client({
            endpoint: this.cfg.endpoint || undefined,
            region: 'us-east-1',
            forcePathStyle: true,
            credentials: {
              accessKeyId: this.cfg.accessKey,
              secretAccessKey: this.cfg.secretKey,
            },
          }),
      )
    }
    return this.clientPromise
  }

  async put(key: string, data: Buffer): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const c = await this.client()
    await c.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: data }))
  }

  async get(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')
    const c = await this.client()
    const res = await c.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }))
    return Buffer.from(await res.Body.transformToByteArray())
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const c = await this.client()
    await c.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }))
  }

  async exists(key: string): Promise<boolean> {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3')
    const c = await this.client()
    try {
      await c.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }))
      return true
    } catch {
      return false
    }
  }
}
