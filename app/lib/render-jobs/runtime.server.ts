import {resolve} from 'node:path';
import {createFilesystemRenderJobRepository, type FilesystemRenderJobRepository} from './render-job-repository.server';

type RuntimeGlobal = typeof globalThis & {__clipjsRenderRepository?: FilesystemRenderJobRepository};
const runtimeGlobal = globalThis as RuntimeGlobal;

export const getRenderJobRepository = (): FilesystemRenderJobRepository => {
  if (!runtimeGlobal.__clipjsRenderRepository) {
    runtimeGlobal.__clipjsRenderRepository = createFilesystemRenderJobRepository({
      rootDirectory: resolve(/*turbopackIgnore: true*/ process.env.CLIPJS_RENDER_JOB_DIR || '.clipjs-runtime/render-jobs'),
    });
  }
  return runtimeGlobal.__clipjsRenderRepository;
};
