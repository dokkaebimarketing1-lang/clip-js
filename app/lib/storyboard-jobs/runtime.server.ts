import {isAbsolute, resolve} from 'node:path';
import {createFilesystemStoryboardJobRepository, type StoryboardJobRepository} from './storyboard-job-repository.server';

type StoryboardRuntimeGlobal = typeof globalThis & {
  __clipjsStoryboardJobRepository?: StoryboardJobRepository;
};

export const resolveStoryboardJobDirectory = ({
  nodeEnv,
  configuredDirectory,
  cwd,
}: {
  nodeEnv?: string;
  configuredDirectory?: string;
  cwd: string;
}): string => {
  const configured = configuredDirectory?.trim();
  if (nodeEnv === 'production') {
    if (!configured) {
      throw new Error('CLIPJS_STORYBOARD_JOB_DIR is required in production and must point to a shared persistent volume.');
    }
    if (!isAbsolute(configured)) {
      throw new Error('CLIPJS_STORYBOARD_JOB_DIR must be an absolute path in production.');
    }
    return configured;
  }
  return resolve(/* turbopackIgnore: true */ cwd, configured || '.clipjs-runtime/storyboard-jobs');
};

export const getStoryboardJobRepository = (): StoryboardJobRepository => {
  const runtime = globalThis as StoryboardRuntimeGlobal;
  return runtime.__clipjsStoryboardJobRepository ??= createFilesystemStoryboardJobRepository({
    rootDirectory: resolveStoryboardJobDirectory({
      nodeEnv: process.env.NODE_ENV,
      configuredDirectory: process.env.CLIPJS_STORYBOARD_JOB_DIR,
      cwd: process.cwd(),
    }),
  });
};
