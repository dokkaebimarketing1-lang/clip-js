export const HIGGSFIELD_IMAGE_RESULT_HOSTS = ['d8j0ntlcm91z4.cloudfront.net'] as const;
export const HIGGSFIELD_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
// Vercel Functions reject request bodies above 4.5 MB. Keep multipart payloads below 4 MiB.
export const HIGGSFIELD_WORKER_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
