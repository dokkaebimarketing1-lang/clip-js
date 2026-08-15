import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {downloadHiggsfieldProviderImage} from '../app/lib/higgsfield/provider-result-download';

const baseUrl = (process.env.CLIPJS_WORKER_BASE_URL || 'https://clip-js-three.vercel.app').replace(/\/$/, '');
const token = process.env.CLIPJS_AGENT_TOKEN || '';
const once = process.argv.includes('--once');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const run = (args: string[]): Promise<unknown> => new Promise((resolve, reject) => {
  const child = spawn('higgsfield', args, {windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code !== 0) return reject(new Error(`Higgsfield CLI exited with ${code}: ${stderr.slice(-1000)}`));
    try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Higgsfield CLI returned invalid JSON.')); }
  });
});

const findString = (value: unknown, keys: string[], pattern?: RegExp): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === 'string' && (!pattern || pattern.test(candidate))) return candidate;
  }
  for (const child of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) {
    const found = findString(child, keys, pattern);
    if (found) return found;
  }
  return undefined;
};
const uuid = (value: unknown) => findString(value, ['job_id', 'jobId', 'id', 'uuid'], /^[a-f0-9-]{36}$/i);
const status = (value: unknown) => (findString(value, ['status', 'state']) || '').toLowerCase();
const resultUrl = (value: unknown) => findString(value, ['result_url', 'min_result_url', 'url', 'download_url'], /^https?:\/\//i);
const uploadId = (value: unknown) => findString(value, ['upload_id', 'uploadId', 'id', 'uuid']);
const creditCost = (value: unknown) => {
  if (!value || typeof value !== 'object') return undefined;
  const credits = (value as Record<string, unknown>).credits;
  return typeof credits === 'number' && Number.isFinite(credits) ? credits : undefined;
};

const agentFetch = async (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${baseUrl}${path}`, {...init, headers});
  if (!response.ok && response.status !== 204) throw new Error(`Agent API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response;
};

const update = async (fields: Record<string, string | Blob>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  await agentFetch('/api/agent/higgsfield/character-image', {method: 'POST', body: form});
};

const processJob = async (payload: {job: Record<string, unknown>; referenceUrls: string[]; resumeProviderJobId?: string}) => {
  const job = payload.job;
  const requestKey = String(job.requestKey);
  const leaseToken = String(job.leaseToken || '');
  let providerJobId = payload.resumeProviderJobId;
  const directory = await mkdtemp(join(tmpdir(), 'clipjs-higgsfield-'));
  try {
    if (!providerJobId) {
      const referenceIds: string[] = [];
      for (let index = 0; index < payload.referenceUrls.length; index += 1) {
        const response = await fetch(payload.referenceUrls[index]);
        if (!response.ok) throw new Error(`Reference download failed: ${response.status}`);
        const path = join(directory, `reference-${index}.bin`);
        await writeFile(path, new Uint8Array(await response.arrayBuffer()));
        const uploaded = await run(['upload', 'create', path, '--json']);
        const id = uploadId(uploaded);
        if (!id) throw new Error('Higgsfield upload did not return an ID.');
        referenceIds.push(id);
      }
      const generationArgs = ['--prompt', String(job.prompt), '--aspect_ratio', String(job.aspectRatio), '--resolution', String(job.resolution), '--thinking', String(job.thinking)];
      for (const id of referenceIds) generationArgs.push('--image-references', id);
      const quote = creditCost(await run(['generate', 'cost', String(job.model), ...generationArgs, '--json']));
      if (quote !== Number(job.expectedCredits)) throw new Error(`Cost changed: approved ${job.expectedCredits}, current ${quote ?? 'unknown'}.`);
      await update({action: 'prepare', requestKey, leaseToken});
      const args = ['generate', 'create', String(job.model), ...generationArgs, '--json'];
      let submitted: unknown;
      try {
        submitted = await run(args);
        providerJobId = uuid(submitted);
        if (!providerJobId) throw new Error('Higgsfield submission did not return a job ID.');
      } catch (error) {
        await update({action: 'uncertain', requestKey, leaseToken, reason: error instanceof Error ? error.message : 'CLI submission result is uncertain.'});
        return;
      }
      let receiptError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await update({action: 'receipt', requestKey, leaseToken, providerJobId});
          receiptError = undefined;
          break;
        } catch (error) {
          receiptError = error;
          if (attempt < 2) await sleep(2_000);
        }
      }
      if (receiptError) {
        await update({action: 'uncertain', requestKey, leaseToken, providerJobId, reason: 'Provider accepted the request but receipt persistence failed.'}).catch(() => undefined);
        throw receiptError;
      }
    }
    for (;;) {
      const current = await run(['jobs', 'get', providerJobId, '--json']);
      const currentStatus = status(current);
      if (currentStatus === 'completed') {
        const url = resultUrl(current);
        if (!url) throw new Error('Completed Higgsfield job has no result URL.');
        const {bytes, type} = await downloadProviderImage(url);
        await update({action: 'complete', requestKey, providerJobId, file: new Blob([bytes], {type})});
        return;
      }
      if (['failed', 'error', 'cancelled', 'canceled'].includes(currentStatus)) {
        await update({action: 'failed', requestKey, providerJobId, reason: `Provider finished with status ${currentStatus}.`});
        return;
      }
      await sleep(15_000);
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
};

const main = async () => {
  if (!token || process.env.CLIPJS_HIGGSFIELD_WORKER_ENABLED !== 'true') {
    throw new Error('CLIPJS_AGENT_TOKEN and CLIPJS_HIGGSFIELD_WORKER_ENABLED=true are required.');
  }
  console.log(`Higgsfield worker connected to ${baseUrl}.`);
  for (;;) {
    try {
      const response = await agentFetch('/api/agent/higgsfield/character-image');
      if (response.status === 204) {
        if (once) break;
        await sleep(5_000);
        continue;
      }
      await processJob(await response.json());
    } catch (error) {
      console.error('Higgsfield worker cycle failed:', error instanceof Error ? error.message : error);
      if (once) process.exitCode = 1;
      if (once) break;
      await sleep(10_000);
    }
  }
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
