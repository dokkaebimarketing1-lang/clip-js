import path from 'node:path';
import {rm} from 'node:fs/promises';
import {bundle} from '@remotion/bundler';

const root = process.cwd();
const outDir = path.join(root, 'remotion-bundle');
await rm(outDir, {recursive: true, force: true});
await bundle({
  entryPoint: path.join(root, 'remotion/index.ts'),
  outDir,
  publicDir: path.join(root, 'public'),
  webpackOverride: (configuration) => configuration,
});
console.log(`Remotion bundle ready: ${outDir}`);
