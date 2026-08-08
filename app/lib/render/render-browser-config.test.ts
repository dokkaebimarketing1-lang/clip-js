import {describe, expect, it} from 'vitest';
import {getRenderBrowserExecutable} from './render-browser-config';

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
});
