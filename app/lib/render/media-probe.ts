import 'server-only';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {RemoteMediaKind} from './remote-media-format';
import {
  verifiedAudioMetadataSchema,
  verifiedVideoMetadataSchema,
  type VerifiedAudioMetadata,
  type VerifiedVideoMetadata,
} from '@/app/lib/assets/generated-asset-schema';

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

type RichProbeStream = {
  codec_type?: string; codec_name?: string; width?: number; height?: number;
  r_frame_rate?: string; avg_frame_rate?: string;
  duration?: string;
};
type RichProbeResult = {
  format?: {format_name?: string; duration?: string; size?: string};
  streams?: RichProbeStream[];
};

const rate = (value: string | undefined): number => {
  if (!value) return 0;
  const [numerator, denominator = '1'] = value.split('/');
  const parsed = Number(numerator) / Number(denominator);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const assertGeneratedVideoProbe = (
  probe: RichProbeResult,
  expectedDurationSeconds?: number,
): VerifiedVideoMetadata => {
  const streams = probe.streams ?? [];
  if (streams.length < 1 || streams.length > 2) throw new Error('Generated video must contain one video stream and at most one audio stream.');
  const video = streams.filter((stream) => stream.codec_type === 'video');
  const audio = streams.filter((stream) => stream.codec_type === 'audio');
  const forbidden = streams.filter((stream) => !['video', 'audio'].includes(stream.codec_type ?? ''));
  if (video.length !== 1) throw new Error('Generated video must contain exactly one video stream.');
  if (audio.length > 1) throw new Error('Generated video must contain at most one audio stream.');
  if (forbidden.length) throw new Error('Generated video contains subtitle, data, or attachment streams.');
  if (!['h264', 'hevc'].includes(video[0].codec_name ?? '')) throw new Error('Generated video codec is not allowed.');
  if (audio.some((stream) => stream.codec_name !== 'aac')) throw new Error('Generated video audio codec is not allowed.');
  const width = video[0].width ?? 0;
  const height = video[0].height ?? 0;
  if (width < 64 || height < 64 || width > 4096 || height > 4096) throw new Error('Generated video resolution is outside the allowed bounds.');
  const fps = rate(video[0].avg_frame_rate) || rate(video[0].r_frame_rate);
  if (fps <= 0 || fps > 60) throw new Error('Generated video frame rate is outside the allowed bounds.');
  const durationSeconds = Number(probe.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 32) throw new Error('Generated video duration is outside the allowed bounds.');
  if (expectedDurationSeconds !== undefined && Math.abs(durationSeconds - expectedDurationSeconds) > 2) {
    throw new Error('Generated video duration does not match the authorized request.');
  }
  const videoDuration = Number(video[0].duration);
  if (!Number.isFinite(videoDuration) || Math.abs(videoDuration - durationSeconds) > 0.25) {
    throw new Error('Generated video stream duration does not match its container duration.');
  }
  if (audio.length) {
    const audioDuration = Number(audio[0].duration);
    if (!Number.isFinite(audioDuration) || Math.abs(audioDuration - durationSeconds) > 0.25) {
      throw new Error('Generated audio stream duration does not match the video duration.');
    }
  }
  const names = (probe.format?.format_name ?? '').split(',');
  if (!names.some((name) => ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'].includes(name))) throw new Error('Generated video container is not allowed.');
  return verifiedVideoMetadataSchema.parse({
    container: 'mp4',
    videoCodec: video[0].codec_name,
    audioCodec: audio[0]?.codec_name,
    width,
    height,
    fps,
    durationSeconds,
    videoStreams: 1,
    audioStreams: audio.length as 0 | 1,
  });
};

export const probeAndDecodeGeneratedVideo = async (
  filePath: string,
  expectedDurationSeconds?: number,
): Promise<VerifiedVideoMetadata> => {
  const probeExecutable = process.env.CLIPJS_FFPROBE_PATH || 'ffprobe';
  const ffmpegExecutable = process.env.CLIPJS_FFMPEG_PATH || 'ffmpeg';
  let stdout: string;
  try {
    ({stdout} = await execFileAsync(probeExecutable, [
      '-v', 'error', '-show_entries',
      'format=format_name,duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,duration',
      '-of', 'json', filePath,
    ], {timeout: 20_000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8'}));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error('ffprobe is unavailable for generated video validation.');
    throw new Error(`ffprobe failed for generated video validation${code ? ` (${code})` : ''}.`);
  }
  let probe: RichProbeResult;
  try { probe = JSON.parse(stdout) as RichProbeResult; } catch { throw new Error('ffprobe returned invalid JSON for generated video.'); }
  const metadata = assertGeneratedVideoProbe(probe, expectedDurationSeconds);
  try {
    await execFileAsync(ffmpegExecutable, ['-v', 'error', '-xerror', '-err_detect', 'explode', '-i', filePath, '-map', '0:v:0', '-map', '0:a:0?', '-f', 'null', '-'], {
      timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8',
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error('ffmpeg is unavailable for generated video decode validation.');
    throw new Error(`Generated video decode smoke test failed${code ? ` (${code})` : ''}.`);
  }
  return metadata;
};

export const probeAndDecodeManagedAudio = async (filePath: string): Promise<VerifiedAudioMetadata> => {
  const probeExecutable = process.env.CLIPJS_FFPROBE_PATH || 'ffprobe';
  const ffmpegExecutable = process.env.CLIPJS_FFMPEG_PATH || 'ffmpeg';
  let stdout: string;
  try {
    ({stdout} = await execFileAsync(probeExecutable, [
      '-v', 'error', '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name', '-of', 'json', filePath,
    ], {timeout: 20_000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8'}));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error('ffprobe is unavailable for managed audio validation.');
    throw new Error(`ffprobe failed for managed audio validation${code ? ` (${code})` : ''}.`);
  }
  let probe: RichProbeResult;
  try { probe = JSON.parse(stdout) as RichProbeResult; } catch { throw new Error('ffprobe returned invalid JSON for managed audio.'); }
  const streams = probe.streams ?? [];
  if (streams.length !== 1 || streams[0].codec_type !== 'audio') throw new Error('Managed audio must contain exactly one audio stream and no video/data streams.');
  const codec = streams[0].codec_name;
  if (!codec || !['mp3', 'pcm_s16le', 'aac', 'opus'].includes(codec)) throw new Error('Managed audio codec is not allowed.');
  const durationSeconds = Number(probe.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3_600) throw new Error('Managed audio duration is outside the allowed bounds.');
  const names = (probe.format?.format_name ?? '').split(',');
  const container = names.includes('mp3') ? 'mp3'
    : names.includes('wav') ? 'wav'
      : names.some((name) => ['mov', 'mp4', 'm4a'].includes(name)) ? 'm4a'
        : names.some((name) => ['matroska', 'webm'].includes(name)) ? 'webm' : undefined;
  if (!container) throw new Error('Managed audio container is not allowed.');
  const metadata = verifiedAudioMetadataSchema.parse({container, audioCodec: codec, durationSeconds, videoStreams: 0, audioStreams: 1});
  try {
    await execFileAsync(ffmpegExecutable, ['-v', 'error', '-xerror', '-err_detect', 'explode', '-i', filePath, '-map', '0:a:0', '-f', 'null', '-'], {
      timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8',
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error('ffmpeg is unavailable for managed audio decode validation.');
    throw new Error(`Managed audio decode smoke test failed${code ? ` (${code})` : ''}.`);
  }
  return metadata;
};
