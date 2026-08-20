import {describe, expect, it} from 'vitest';
import {resolveHiggsfieldCliInvocation} from './higgsfield-cli-command';

describe('resolveHiggsfieldCliInvocation', () => {
  it('runs the real CLI JavaScript entrypoint with Node on Windows', () => {
    const entrypoint = 'C:\\cli\\node_modules\\@higgsfield\\cli\\bin\\higgsfield.js';
    const result = resolveHiggsfieldCliInvocation(['--version'], {
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
      env: {CLIPJS_HIGGSFIELD_CLI_ENTRYPOINT: entrypoint},
      pathExists: (path) => path === entrypoint,
    });

    expect(result).toEqual({command: 'C:\\node\\node.exe', args: [entrypoint, '--version']});
  });

  it('discovers the CLI installed beside the active Hermes Node runtime', () => {
    const expected = 'C:\\hermes\\node\\node_modules\\@higgsfield\\cli\\bin\\higgsfield.js';
    const result = resolveHiggsfieldCliInvocation(['generate', 'cost'], {
      platform: 'win32',
      execPath: 'C:\\hermes\\node\\node.exe',
      env: {},
      pathExists: (path) => path === expected,
    });

    expect(result).toEqual({command: 'C:\\hermes\\node\\node.exe', args: [expected, 'generate', 'cost']});
  });

  it('keeps direct executable lookup on non-Windows systems', () => {
    expect(resolveHiggsfieldCliInvocation(['--version'], {
      platform: 'linux',
      execPath: '/usr/bin/node',
      env: {},
      pathExists: () => false,
    })).toEqual({command: 'higgsfield', args: ['--version']});
  });

  it('fails closed when no Windows CLI entrypoint is installed', () => {
    expect(() => resolveHiggsfieldCliInvocation([], {
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
      env: {},
      pathExists: () => false,
    })).toThrow('Higgsfield CLI JavaScript entrypoint was not found');
  });
});
