import 'server-only';
import path from 'node:path';
import {access, mkdir, readdir, stat, unlink} from 'node:fs/promises';
import {renderMedia, selectComposition} from '@remotion/renderer';
import type {ProjectState} from '@/app/types';
import {stageRemoteMedia} from './stage-remote-media';

const RENDER_RETENTION_MS = 24 * 60 * 60 * 1000;
let renderQueue: Promise<void> = Promise.resolve();

const removeExpiredRenders = async (outputDir: string): Promise<void> => {
  const files = await readdir(outputDir).catch(() => [] as string[]);
  await Promise.all(files.filter((file) => /^[0-9a-f-]{36}\.mp4$/i.test(file)).map(async (file) => {
    const location = path.join(outputDir, file);
    const metadata = await stat(location);
    if (Date.now() - metadata.mtimeMs > RENDER_RETENTION_MS) await unlink(location);
  }));
};

const performRender = async (project: ProjectState): Promise<{renderId: string; outputLocation: string}> => {
  const serveUrl = path.join(process.cwd(), 'remotion-bundle');
  await access(path.join(serveUrl, 'index.html')).catch(() => {
    throw new Error('Remotion bundle is missing. Run npm run build:remotion first.');
  });
  const renderId = crypto.randomUUID();
  const outputDir = path.join(process.cwd(), 'renders');
  await mkdir(outputDir, {recursive: true});
  await removeExpiredRenders(outputDir);
  const outputLocation = path.join(outputDir, `${renderId}.mp4`);
  const staged = await stageRemoteMedia(project, serveUrl, renderId);
  try {
    const inputProps = {project: staged.project};
    const composition = await selectComposition({serveUrl, id: 'ClipJsProject', inputProps});
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation,
      inputProps,
      crf: project.exportSettings.quality === 'high' ? 16 : 23,
    });
    return {renderId, outputLocation};
  } finally {
    await staged.cleanup();
  }
};

export const renderApprovedProject = (project: ProjectState): Promise<{renderId: string; outputLocation: string}> => {
  const snapshot = structuredClone(project);
  const job = renderQueue.then(() => performRender(snapshot));
  renderQueue = job.then(() => undefined, () => undefined);
  return job;
};
