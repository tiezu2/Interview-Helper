// @aws-sdk/client-s3 is only installed in prod (STORAGE_DRIVER=s3) and
// loaded lazily; this shim keeps dev type-checking green without it.
declare module '@aws-sdk/client-s3' {
  export const S3Client: any
  export const PutObjectCommand: any
  export const GetObjectCommand: any
  export const DeleteObjectCommand: any
  export const HeadObjectCommand: any
}
