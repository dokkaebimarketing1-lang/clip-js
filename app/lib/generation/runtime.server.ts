import {resolve} from 'node:path';
import {createFilesystemGenerationRepository} from './generation-repository.server';
import {createLocalGeneratedAssetStore} from '@/app/lib/assets/generated-asset-store.server';
import {FakeGenerationProvider, type GenerationProviderClient} from './provider';
import {createBytePlusGenerationProvider} from '@/app/lib/byteplus/byteplus-provider.server';

const globalRuntime = globalThis as typeof globalThis & {
  __clipjsGenerationRepository?: ReturnType<typeof createFilesystemGenerationRepository>;
  __clipjsGeneratedAssetStore?: ReturnType<typeof createLocalGeneratedAssetStore>;
  __clipjsFakeGenerationProvider?: FakeGenerationProvider;
};

export const getGenerationRepository = () => globalRuntime.__clipjsGenerationRepository ??= createFilesystemGenerationRepository({
  rootDirectory: resolve(/*turbopackIgnore: true*/ process.env.CLIPJS_GENERATION_REPOSITORY_DIR || '.clipjs-runtime/generation'),
});

export const getGeneratedAssetStore = () => globalRuntime.__clipjsGeneratedAssetStore ??= createLocalGeneratedAssetStore({
  rootDirectory: resolve(/*turbopackIgnore: true*/ process.env.CLIPJS_GENERATED_ASSET_DIR || '.clipjs-runtime/assets'),
});

export const getConfiguredGenerationProvider = (): GenerationProviderClient => {
  const provider = process.env.CLIPJS_GENERATION_PROVIDER || 'disabled';
  if (provider === 'fake' && process.env.NODE_ENV !== 'production') {
    return globalRuntime.__clipjsFakeGenerationProvider ??= new FakeGenerationProvider();
  }
  if (provider === 'byteplus') {
    const apiKey = process.env.BYTEPLUS_ARK_API_KEY;
    if (!apiKey) throw new Error('BYTEPLUS_ARK_API_KEY is required.');
    return createBytePlusGenerationProvider({apiKey});
  }
  throw new Error('No generation provider is enabled.');
};

export const isGenerationSubmitEnabled = (): boolean =>
  process.env.BYTEPLUS_GENERATION_SUBMIT_ENABLED === 'true'
  && (process.env.CLIPJS_GENERATION_PROVIDER === 'byteplus'
    || (process.env.CLIPJS_GENERATION_PROVIDER === 'fake' && process.env.NODE_ENV !== 'production'));
