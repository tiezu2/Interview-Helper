import { config } from '../../config.js'
import { LocalStorageDriver } from './local.js'
import { S3StorageDriver } from './s3.js'

// CD5: storage behind a driver interface — local disk in dev, MinIO/S3 in prod.
export interface StorageService {
  put(key: string, data: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}

let instance: StorageService | null = null

export function getStorage(): StorageService {
  if (!instance) {
    instance =
      config.storageDriver === 's3'
        ? new S3StorageDriver(config.s3)
        : new LocalStorageDriver(config.localStoragePath)
  }
  return instance
}

export function setStorageForTests(s: StorageService) {
  instance = s
}
