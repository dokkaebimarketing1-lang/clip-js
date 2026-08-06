export const normalizeRenderDownloadUrl = (value: unknown, origin: string): string => {
  if (typeof value !== 'string' || !value) throw new Error('Render returned an invalid download URL.');
  const base = new URL(origin);
  const download = new URL(value, base);
  if (download.origin !== base.origin || !/^\/api\/render\/file\/[^/]+$/.test(download.pathname)) {
    throw new Error('Render returned an invalid download URL.');
  }
  return `${download.pathname}${download.search}`;
};
