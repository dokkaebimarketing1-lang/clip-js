import {spawn} from 'node:child_process';
import {buildHiggsfieldCliArgs, higgsfieldSeedanceRequestSchema, type HiggsfieldSeedanceRequest} from '@/app/lib/workflow/seedance-master';

const MAX_OUTPUT_BYTES = 1_000_000;
const START_TIMEOUT_MS = 90_000;

export const submitHiggsfieldSeedanceJob = (input: HiggsfieldSeedanceRequest): Promise<unknown> => {
  const request = higgsfieldSeedanceRequestSchema.parse(input);
  const executable = process.env.HIGGSFIELD_CLI_PATH?.trim() || 'higgsfield';
  const args = buildHiggsfieldCliArgs(request);
  return new Promise((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ executable, args, {shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    let size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Higgsfield job submission timed out.'));
    }, START_TIMEOUT_MS);
    const collect = (target: 'stdout'|'stderr', chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        child.kill();
        reject(new Error('Higgsfield CLI output exceeded the safety limit.'));
        return;
      }
      if (target === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk));
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`Higgsfield CLI rejected the request${stderr.trim() ? `: ${stderr.trim()}` : '.'}`));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new Error('Higgsfield CLI returned an invalid JSON response.')); }
    });
    child.stdin.end(request.prompt, 'utf8');
  });
};
