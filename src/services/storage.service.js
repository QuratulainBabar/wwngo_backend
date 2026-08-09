import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env.js';
import { UPLOADS_ROOT } from './delivery.service.js';

let s3Client = null;

function isS3Configured() {
  return Boolean(env.s3?.bucket && env.s3?.region && env.s3?.accessKeyId);
}

async function getS3() {
  if (!isS3Configured()) return null;
  if (!s3Client) {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    s3Client = {
      client: new S3Client({
        region: env.s3.region,
        credentials: {
          accessKeyId: env.s3.accessKeyId,
          secretAccessKey: env.s3.secretAccessKey,
        },
      }),
      PutObjectCommand,
    };
  }
  return s3Client;
}

/**
 * Store a file buffer — S3 when configured, otherwise local disk under /uploads.
 * Returns { filePath, publicUrl }.
 */
export async function storeFile({
  buffer,
  relativePath,
  mimeType,
  originalName,
}) {
  if (isS3Configured()) {
    const s3 = await getS3();
    const key = relativePath.replace(/\\/g, '/');
    await s3.client.send(
      new s3.PutObjectCommand({
        Bucket: env.s3.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        Metadata: { originalName: originalName || '' },
      })
    );
    const publicUrl = env.s3.publicBaseUrl
      ? `${env.s3.publicBaseUrl.replace(/\/$/, '')}/${key}`
      : `https://${env.s3.bucket}.s3.${env.s3.region}.amazonaws.com/${key}`;
    return { filePath: key, publicUrl, storage: 's3' };
  }

  const fullPath = path.join(UPLOADS_ROOT, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);
  const normalized = relativePath.replace(/\\/g, '/');
  return {
    filePath: normalized,
    publicUrl: `/uploads/${normalized.replace(/^uploads\//, '')}`,
    storage: 'local',
  };
}

export function storageMode() {
  return isS3Configured() ? 's3' : 'local';
}
