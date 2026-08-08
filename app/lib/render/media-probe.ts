import 'server-only';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {RemoteMediaKind} from './remote-media-format';

const execFileAsync = promisify(execFile);

type ProbeResult = {streams?: Array<{codec_type?: string}>};

export const assertExpectedMediaStreams = (kind: RemoteMediaKind, probe: ProbeResult): void => {
  if (kind === 'image') return;
  const streamTypes = (probe.streams ?? []).map((stream) => stream.codec_type);
  if (kind === 'video' && !streamTypes.includes('video')) {
    throw new Error('Remote video asset does not contain a video stream.');
  }
  if (kind === 'audio') {
    if (!streamTypes.includes('audio')) throw new Error('Remote audio asset does not contain an audio stream.');
    if (streamTypes.includes('video')) throw new Error('Remote audio asset must not contain a video stream.');
  }
};

export const verifyStagedMediaStreams = async (filePath: string, kind: RemoteMediaKind): Promise<void> => {
  if (kind === 'image') return;
  const executable = process.env.CLIPJS_FFPROBE_PATH || 'ffprobe';
  let stdout: string;
  try {
    ({stdout} = await execFileAsync(executable, [
      '-v', 'error',
      '-show_entries', 'stream=codec_type',
      '-of', 'json',
      filePath,
    ], {timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true}));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error('ffprobe is unavailable. Install ffprobe or set CLIPJS_FFPROBE_PATH.');
    if (code === 'ETIMEDOUT') throw new Error('ffprobe timed out while validating a staged media asset.');
    throw new Error(`ffprobe failed while validating a staged media asset${code ? ` (${code})` : ''}.`);
  }
  let parsed: ProbeResult;
  try {
    parsed = JSON.parse(stdout) as ProbeResult;
  } catch {
    throw new Error('ffprobe returned invalid JSON for a staged media asset.');
  }
  assertExpectedMediaStreams(kind, parsed);
};
