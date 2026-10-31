import 'dotenv/config'

export const config = {
  port: Number(process.env.PORT ?? 3001),
  // 生产/局域网模式：为 true 时改用 HTTPS（自签证书），否则浏览器会禁用摄像头
  useHttps: (process.env.USE_HTTPS ?? '') === '1',
  httpsCert: process.env.HTTPS_CERT ?? '',
  httpsKey: process.env.HTTPS_KEY ?? '',
  certDir: process.env.CERT_DIR ?? './certs',
  // 前端构建产物目录；存在则由后端直接托管（单端口部署）
  staticDir: process.env.STATIC_DIR ?? '../frontend/dist',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-do-not-use-in-prod',
  storageDriver: (process.env.STORAGE_DRIVER ?? 'local') as 'local' | 's3',
  localStoragePath: process.env.LOCAL_STORAGE_PATH ?? './data/recordings',
  llmProvider: process.env.LLM_PROVIDER ?? 'none',
  retentionDays: Number(process.env.RECORDING_RETENTION_DAYS ?? 30),
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? '',
    bucket: process.env.S3_BUCKET ?? 'recordings',
    accessKey: process.env.S3_ACCESS_KEY ?? '',
    secretKey: process.env.S3_SECRET_KEY ?? '',
  },
}
