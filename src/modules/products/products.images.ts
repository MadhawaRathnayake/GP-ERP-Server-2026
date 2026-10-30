import { randomUUID } from "node:crypto"
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { env } from "#config/env.js"

// Product images live in Cloudflare R2. The browser uploads straight to R2 with a short-lived signed URL, so image
// bytes never pass through this server; the product then stores the public URL in imageUrl.
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  // Otherwise the SDK signs a checksum of an empty body into the URL, and R2 rejects the browser's real upload.
  requestChecksumCalculation: "WHEN_REQUIRED",
})

export const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const
export type ImageType = keyof typeof IMAGE_TYPES

const UPLOAD_URL_TTL_SECONDS = 5 * 60

/** A URL the browser can PUT one image to, and the public URL it will have afterwards. */
export async function createImageUploadUrl(contentType: ImageType) {
  const key = `products/${randomUUID()}.${IMAGE_TYPES[contentType]}`
  // ContentType is part of the signature: the upload must send the same Content-Type header, or R2 rejects it.
  const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, ContentType: contentType }), {
    expiresIn: UPLOAD_URL_TTL_SECONDS,
    signableHeaders: new Set(["content-type"]),
  })
  return { uploadUrl, publicUrl: `${env.R2_PUBLIC_URL}/${key}`, expiresIn: UPLOAD_URL_TTL_SECONDS }
}
