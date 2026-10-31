import { mkdir, readFile, writeFile, unlink, access } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import type { StorageService } from './index.js'

export class LocalStorageDriver implements StorageService {
  constructor(private basePath: string) {}

  private resolve(key: string): string {
    const path = normalize(join(this.basePath, key))
    if (!path.startsWith(normalize(this.basePath))) {
      throw new Error('Invalid storage key')
    }
    return path
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.resolve(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, data)
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key))
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key))
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key))
      return true
    } catch {
      return false
    }
  }
}
