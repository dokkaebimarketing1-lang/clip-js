import {getConfiguredGenerationProvider, getGeneratedAssetStore, getGenerationRepository} from '../app/lib/generation/runtime.server';
import {runGenerationWorkerTick} from '../app/lib/generation/generation-worker.server';
import {createSecureBytePlusResultIngestor} from '../app/lib/assets/secure-byteplus-ingest.server';

const main = async () => {
  const controller = new AbortController();
  const workerId = `generation-worker-${process.pid}`;
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const provider = getConfiguredGenerationProvider();
  const ingestResult = createSecureBytePlusResultIngestor({assetStore: getGeneratedAssetStore()});
  const sleep = (milliseconds: number) => new Promise<void>((resolve) => {
    const onAbort = () => { clearTimeout(timeout); resolve(); };
    const timeout = setTimeout(() => { controller.signal.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
    controller.signal.addEventListener('abort', onAbort, {once: true});
  });
  const runOnce = process.argv.includes('--once');
  while (!controller.signal.aborted) {
    try {
      await runGenerationWorkerTick({
        repository: getGenerationRepository(),
        provider,
        workerId,
        ingestResult,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) break;
      console.error('Generation worker tick failed:', error);
    }
    if (runOnce) break;
    await sleep(2000);
  }
};

void main().catch((error) => {
  console.error('Generation worker failed to start:', error);
  process.exitCode = 1;
});
