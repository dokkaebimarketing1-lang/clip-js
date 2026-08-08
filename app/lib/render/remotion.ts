import 'server-only';
import path from 'node:path';
import {access, mkdir, readdir, stat, unlink} from 'node:fs/promises';
import {makeCancelSignal, openBrowser, renderMedia, selectComposition} from '@remotion/renderer';
import type {ProjectState} from '@/app/types';
import {stageRemoteMedia} from './stage-remote-media';
import {withTimeout} from './timeout';
import {createSerialTaskQueue} from './serial-task-queue';
import {getRenderBrowserExecutable} from './render-browser-config';
import {
  COMPOSITION_TIMEOUT_MS,
  DELAY_RENDER_TIMEOUT_MS,
  RENDER_HARD_TIMEOUT_MS,
  STAGING_TIMEOUT_MS,
} from './render-budget';

const RENDER_RETENTION_MS = 24 * 60 * 60 * 1000;
const enqueueRender = createSerialTaskQueue(1, 'Render queue is full. Try again after the active render completes.');

const removeExpiredRenders = async (outputDir: string): Promise<void> => {
  const files = await readdir(outputDir).catch(() => [] as string[]);
  await Promise.all(files.filter((file) => /^[0-9a-f-]{36}\.mp4$/i.test(file)).map(async (file) => {
    const location = path.join(outputDir, file);
    const metadata = await stat(location).catch(() => null);
    if (metadata && Date.now() - metadata.mtimeMs > RENDER_RETENTION_MS) {
      await unlink(location).catch(() => undefined);
    }
  }));
};

const performRender = async (project: ProjectState): Promise<{renderId: string; outputLocation: string}> => {
  const serveUrl = path.resolve(/*turbopackIgnore: true*/ process.env.CLIPJS_REMOTION_BUNDLE_DIR || path.join(process.cwd(), 'remotion-bundle'));
  const browserExecutable = getRenderBrowserExecutable();
  await access(path.join(serveUrl, 'index.html')).catch(() => {
    throw new Error('Remotion bundle is missing. Run npm run build:remotion first.');
  });
  const renderId = crypto.randomUUID();
  const outputDir = path.resolve(/*turbopackIgnore: true*/ process.env.CLIPJS_RENDER_OUTPUT_DIR || path.join(process.cwd(), 'renders'));
  await mkdir(outputDir, {recursive: true});
  await removeExpiredRenders(outputDir);
  const outputLocation = path.join(outputDir, `${renderId}.mp4`);
  const stagingController = new AbortController();
  const staged = await withTimeout(
    stageRemoteMedia(project, serveUrl, renderId, stagingController.signal),
    STAGING_TIMEOUT_MS,
    'stageRemoteMedia',
    () => stagingController.abort(),
  );
  let browser: Awaited<ReturnType<typeof openBrowser>> | null = null;
  try {
    const inputProps = {project: staged.project};
    const chromiumOptions = {headless: true};
    browser = await openBrowser('chrome', {browserExecutable, chromiumOptions});
    const compositionPromise = selectComposition({
      serveUrl,
      id: 'ClipJsProject',
      inputProps,
      browserExecutable,
      chromiumOptions,
      puppeteerInstance: browser,
      timeoutInMilliseconds: COMPOSITION_TIMEOUT_MS,
    });
    const composition = await withTimeout(
      compositionPromise,
      COMPOSITION_TIMEOUT_MS,
      'selectComposition',
      () => { void browser?.close({silent: true}).catch(() => undefined); },
    );
    const {cancelSignal, cancel} = makeCancelSignal();
    await withTimeout(renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation,
      inputProps,
      crf: project.exportSettings.quality === 'high' ? 16 : 23,
      timeoutInMilliseconds: DELAY_RENDER_TIMEOUT_MS,
      concurrency: 2,
      browserExecutable,
      chromiumOptions,
      puppeteerInstance: browser,
      cancelSignal,
    }), RENDER_HARD_TIMEOUT_MS, 'renderMedia', cancel);
    return {renderId, outputLocation};
  } catch (error) {
    await unlink(outputLocation).catch(() => undefined);
    throw error;
  } finally {
    if (browser) await browser.close({silent: true}).catch(() => undefined);
    await staged.cleanup();
  }
};

export const renderApprovedProject = (project: ProjectState): Promise<{renderId: string; outputLocation: string}> => {
  const snapshot = structuredClone(project);
  return enqueueRender(() => performRender(snapshot));
};
