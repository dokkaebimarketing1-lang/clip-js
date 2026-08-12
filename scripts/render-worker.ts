import {getRenderJobRepository} from '../app/lib/render-jobs/runtime.server';
import {runRenderWorkerTick} from '../app/lib/render-jobs/render-worker.server';
import {parseProjectState} from '../app/lib/workflow/project-file';
import {verifyReleaseApprovalSignature} from '../app/lib/security/approval-signature';
import {assertRenderReleaseApproved} from '../app/lib/workflow/approval-v3';
import {assertReleasePreflight} from '../app/lib/workflow/release-preflight.server';
import {assertRenderLimits} from '../app/lib/render/limits';
import {renderApprovedProject} from '../app/lib/render/remotion';

const main = async () => {
  const controller = new AbortController();
  const workerId = `render-worker-${process.pid}`;
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const render = async (projectSnapshot: unknown, signal?: AbortSignal) => {
    const project = parseProjectState(projectSnapshot);
    verifyReleaseApprovalSignature(project.id, project.workflow.releaseApproval);
    await assertRenderReleaseApproved(project);
    assertReleasePreflight(project);
    assertRenderLimits(project);
    return renderApprovedProject(project, signal);
  };
  const sleep = (milliseconds: number) => new Promise<void>((resolve) => {
    const onAbort = () => { clearTimeout(timeout); resolve(); };
    const timeout = setTimeout(() => { controller.signal.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
    controller.signal.addEventListener('abort', onAbort, {once: true});
  });
  const runOnce = process.argv.includes('--once');
  while (!controller.signal.aborted) {
    try {
      await runRenderWorkerTick({
        repository: getRenderJobRepository(),
        workerId,
        render,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) break;
      console.error('Render worker tick failed:', error);
    }
    if (runOnce) break;
    await sleep(1000);
  }
};

void main().catch((error) => {
  console.error('Render worker failed to start:', error);
  process.exitCode = 1;
});
