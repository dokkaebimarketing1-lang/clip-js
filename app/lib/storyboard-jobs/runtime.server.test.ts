import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {resolveStoryboardJobDirectory} from './runtime.server';

describe('storyboard job runtime storage', () => {
  it('fails closed in production without an explicit shared persistent directory', () => {
    expect(() => resolveStoryboardJobDirectory({nodeEnv: 'production', cwd: '/app'}))
      .toThrow('CLIPJS_STORYBOARD_JOB_DIR');
  });

  it('rejects a relative production directory', () => {
    expect(() => resolveStoryboardJobDirectory({
      nodeEnv: 'production',
      configuredDirectory: '.clipjs-runtime/storyboard-jobs',
      cwd: '/app',
    })).toThrow('absolute');
  });

  it('accepts an absolute production shared-volume directory', () => {
    expect(resolveStoryboardJobDirectory({
      nodeEnv: 'production',
      configuredDirectory: '/var/lib/clipjs/storyboard-jobs',
      cwd: '/app',
    })).toBe('/var/lib/clipjs/storyboard-jobs');
  });

  it('keeps the local runtime default for development', () => {
    expect(resolveStoryboardJobDirectory({nodeEnv: 'development', cwd: '/workspace'}))
      .toBe(resolve('/workspace', '.clipjs-runtime/storyboard-jobs'));
  });
});
