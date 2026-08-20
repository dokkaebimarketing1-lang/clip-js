import {existsSync} from 'node:fs';
import {win32} from 'node:path';

export type HiggsfieldCliInvocation = {
  command: string;
  args: string[];
};

type ResolverOptions = {
  platform?: NodeJS.Platform;
  execPath?: string;
  env?: Record<string, string | undefined>;
  pathExists?: (path: string) => boolean;
};

const WINDOWS_CLI_RELATIVE_PATH = ['node_modules', '@higgsfield', 'cli', 'bin', 'higgsfield.js'] as const;

export const resolveHiggsfieldCliInvocation = (
  args: string[],
  options: ResolverOptions = {},
): HiggsfieldCliInvocation => {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return {command: 'higgsfield', args};

  const execPath = options.execPath ?? process.execPath;
  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? existsSync;
  const explicitEntrypoint = env.CLIPJS_HIGGSFIELD_CLI_ENTRYPOINT?.trim();
  if (explicitEntrypoint && !win32.isAbsolute(explicitEntrypoint)) {
    throw new Error('CLIPJS_HIGGSFIELD_CLI_ENTRYPOINT must be an absolute Windows path.');
  }

  const candidates = [
    explicitEntrypoint,
    win32.join(win32.dirname(execPath), ...WINDOWS_CLI_RELATIVE_PATH),
    env.APPDATA ? win32.join(env.APPDATA, 'npm', ...WINDOWS_CLI_RELATIVE_PATH) : undefined,
    env.LOCALAPPDATA ? win32.join(env.LOCALAPPDATA, 'hermes', 'node', ...WINDOWS_CLI_RELATIVE_PATH) : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));
  const entrypoint = candidates.find(pathExists);
  if (!entrypoint) {
    throw new Error('Higgsfield CLI JavaScript entrypoint was not found. Set CLIPJS_HIGGSFIELD_CLI_ENTRYPOINT to the installed bin/higgsfield.js path.');
  }

  return {command: execPath, args: [entrypoint, ...args]};
};
