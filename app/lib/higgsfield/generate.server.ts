import {existsSync} from 'node:fs';
import {delimiter, dirname, extname, join, win32} from 'node:path';
import {spawn} from 'node:child_process';
import {
  buildHiggsfieldCliArgs,
  higgsfieldSeedanceRequestSchema,
  type HiggsfieldSeedanceRequest,
} from '@/app/lib/workflow/seedance-master';

const MAX_OUTPUT_BYTES = 1_000_000;
const START_TIMEOUT_MS = 90_000;
const TERMINATION_GRACE_MS = 5_000;

export class HiggsfieldSubmissionTimeoutError extends Error {
  constructor() {
    super('Higgsfield job submission timed out.');
    this.name = 'HiggsfieldSubmissionTimeoutError';
  }
}

type LaunchSpec = {executable: string; prefixArgs: string[]};
export type HiggsfieldAccountStatus = {
  credits: number;
  subscription_plan_type: string;
};
type LaunchOptions = {
  cliPath?: string;
  pathValue?: string;
  platform?: NodeJS.Platform;
  nodeExecutable?: string;
  fileExists?: (path: string) => boolean;
};

const npmCliEntryFromShim = (shimPath: string, platform: NodeJS.Platform): string => {
  const pathApi = platform === 'win32' ? win32 : {dirname, join};
  return pathApi.join(pathApi.dirname(shimPath), 'node_modules', '@higgsfield', 'cli', 'bin', 'higgsfield.js');
};

export const resolveHiggsfieldLaunchSpec = (options: LaunchOptions = {}): LaunchSpec => {
  const platform = options.platform ?? process.platform;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const fileExists = options.fileExists ?? existsSync;
  const configured = options.cliPath?.trim();

  if (configured) {
    const extension = extname(configured).toLowerCase();
    if (extension === '.js') return {executable: nodeExecutable, prefixArgs: [configured]};
    if (platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
      const entry = npmCliEntryFromShim(configured, platform);
      if (!fileExists(entry)) throw new Error('HIGGSFIELD_CLI_PATH points to a Windows shim, but the Higgsfield JavaScript entry was not found.');
      return {executable: nodeExecutable, prefixArgs: [entry]};
    }
    return {executable: configured, prefixArgs: []};
  }

  if (platform !== 'win32') return {executable: 'higgsfield', prefixArgs: []};

  const pathEntries = (options.pathValue ?? process.env.PATH ?? '').split(platform === 'win32' ? win32.delimiter : delimiter).filter(Boolean);
  for (const directory of pathEntries) {
    const pathApi = platform === 'win32' ? win32 : {join};
    const shim = pathApi.join(directory, 'higgsfield.cmd');
    const entry = npmCliEntryFromShim(shim, platform);
    if (fileExists(shim) && fileExists(entry)) return {executable: nodeExecutable, prefixArgs: [entry]};
  }
  throw new Error('Higgsfield CLI was not found on Windows PATH. Set HIGGSFIELD_CLI_PATH to its .cmd shim or JavaScript entry.');
};

export const submitHiggsfieldSeedanceJob = (input: HiggsfieldSeedanceRequest): Promise<unknown> => {
  const request = higgsfieldSeedanceRequestSchema.parse(input);
  const launch = resolveHiggsfieldLaunchSpec({cliPath: process.env.HIGGSFIELD_CLI_PATH});
  const args = [...launch.prefixArgs, ...buildHiggsfieldCliArgs(request)];

  return new Promise((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ launch.executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let size = 0;
    let terminalError: Error | undefined;
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      reject(error);
    };
    const terminate = (error: Error) => {
      if (terminalError) return;
      terminalError = error;
      if (!child.kill()) return settleReject(error);
      graceTimer = setTimeout(() => settleReject(error), TERMINATION_GRACE_MS);
    };
    const timer = setTimeout(() => terminate(new HiggsfieldSubmissionTimeoutError()), START_TIMEOUT_MS);
    const collect = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) return terminate(new Error('Higgsfield CLI output exceeded the safety limit.'));
      if (target === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };

    child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk));
    child.once('error', (error) => settleReject(error));
    child.once('close', (code) => {
      if (settled) return;
      if (terminalError) return settleReject(terminalError);
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      if (code !== 0) return settleReject(new Error(`Higgsfield CLI rejected the request${stderr.trim() ? `: ${stderr.trim()}` : '.'}`));
      try {
        const parsed = JSON.parse(stdout);
        settled = true;
        resolve(parsed);
      } catch {
        settleReject(new Error('Higgsfield CLI returned an invalid JSON response.'));
      }
    });
  });
};

export const getHiggsfieldAccountStatus = (): Promise<HiggsfieldAccountStatus> => {
  const launch = resolveHiggsfieldLaunchSpec({cliPath: process.env.HIGGSFIELD_CLI_PATH});
  const args = [...launch.prefixArgs, 'account', 'status', '--json'];
  return new Promise((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ launch.executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let size = 0;
    let settled = false;
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill();
      settleReject(new Error('Higgsfield account status timed out.'));
    }, 30_000);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) child.kill();
      else stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) child.kill();
      else stderr += chunk.toString('utf8');
    });
    child.once('error', settleReject);
    child.once('close', (code) => {
      if (settled) return;
      clearTimeout(timer);
      if (size > MAX_OUTPUT_BYTES) return settleReject(new Error('Higgsfield CLI output exceeded the safety limit.'));
      if (code !== 0) return settleReject(new Error(`Higgsfield account status failed${stderr.trim() ? `: ${stderr.trim()}` : '.'}`));
      try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        if (typeof parsed.credits !== 'number' || !Number.isFinite(parsed.credits) || typeof parsed.subscription_plan_type !== 'string') {
          throw new Error('invalid account status');
        }
        settled = true;
        resolve({credits: parsed.credits, subscription_plan_type: parsed.subscription_plan_type});
      } catch {
        settleReject(new Error('Higgsfield CLI returned an invalid account status.'));
      }
    });
  });
};
