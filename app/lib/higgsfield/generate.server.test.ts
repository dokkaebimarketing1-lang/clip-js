import {describe, expect, it} from 'vitest';
import {resolveHiggsfieldLaunchSpec} from './generate.server';

describe('Higgsfield CLI launcher', () => {
  it('runs the JavaScript entry with Node instead of spawning a Windows cmd shim', () => {
    const shim = 'C:\\tools\\higgsfield.cmd';
    const entry = 'C:\\tools\\node_modules\\@higgsfield\\cli\\bin\\higgsfield.js';
    const existing = new Set([shim, entry]);
    expect(resolveHiggsfieldLaunchSpec({
      platform: 'win32',
      cliPath: shim,
      nodeExecutable: 'C:\\node\\node.exe',
      fileExists: (path) => existing.has(path),
    })).toEqual({executable: 'C:\\node\\node.exe', prefixArgs: [entry]});
  });

  it('accepts an explicitly configured JavaScript entry', () => {
    expect(resolveHiggsfieldLaunchSpec({
      platform: 'win32',
      cliPath: 'C:\\tools\\higgsfield.js',
      nodeExecutable: 'node.exe',
    })).toEqual({executable: 'node.exe', prefixArgs: ['C:\\tools\\higgsfield.js']});
  });

  it('fails closed when the Windows CLI cannot be resolved', () => {
    expect(() => resolveHiggsfieldLaunchSpec({
      platform: 'win32',
      pathValue: '',
      fileExists: () => false,
    })).toThrow('not found');
  });

  it('keeps the normal executable path on non-Windows hosts', () => {
    expect(resolveHiggsfieldLaunchSpec({platform: 'linux'})).toEqual({executable: 'higgsfield', prefixArgs: []});
  });
});
