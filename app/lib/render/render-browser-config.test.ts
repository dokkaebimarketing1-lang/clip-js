import {describe, expect, it} from 'vitest';
import {getRenderBrowserExecutable, parseHardwareEncoding} from './render-browser-config';

describe('render browser configuration', () => {
  it('fails closed instead of downloading a browser during a render request', () => {
    expect(() => getRenderBrowserExecutable({})).toThrow(
      'REMOTION_BROWSER_EXECUTABLE_PATH is required',
    );
  });

  it('uses the explicitly provisioned browser executable', () => {
    expect(getRenderBrowserExecutable({REMOTION_BROWSER_EXECUTABLE_PATH: '/opt/chrome'}))
      .toBe('/opt/chrome');
  });

  it('disables hardware encoding when the setting is missing', () => {
    expect(parseHardwareEncoding(undefined)).toBeUndefined();
  });

  it('disables hardware encoding when explicitly set to off', () => {
    expect(parseHardwareEncoding('off')).toBeUndefined();
  });

  it.each(['auto', 'if-possible'])('enables best-effort hardware encoding for %s', (value) => {
    expect(parseHardwareEncoding(value)).toBe('if-possible');
  });

  it('rejects unsupported hardware encoding values', () => {
    expect(() => parseHardwareEncoding('on')).toThrow(
      'CLIPJS_RENDER_HW_ENCODING must be one of: auto, if-possible, off',
    );
  });
});
