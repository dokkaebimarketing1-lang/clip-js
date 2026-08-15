import {NextRequest, NextResponse} from 'next/server';
import {authorizeAgentRequest} from '@/app/lib/security/api-auth';
import {createAssetCapability} from '@/app/lib/assets/asset-capability.server';
import {getCharacterImageBlobAsset, ingestCharacterImageBlob} from '@/app/lib/assets/character-image-blob-store.server';
import {getCharacterImageSubmissionRepository} from '@/app/lib/higgsfield/character-image-runtime.server';
import {createCharacterImageWorkerQueue} from '@/app/lib/higgsfield/character-image-worker-queue.server';
import {HIGGSFIELD_WORKER_UPLOAD_MAX_BYTES} from '@/app/lib/higgsfield/result-policy';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID = /^[a-f0-9-]{36}$/i;
const HEX64 = /^[a-f0-9]{64}$/;
const fail = (status = 400) => NextResponse.json({error: status === 401 ? 'Unauthorized.' : 'Worker request failed.'}, {status});

export async function GET(request: NextRequest) {
  let authorized = false;
  try {
    authorizeAgentRequest(request);
    authorized = true;
    const queue = createCharacterImageWorkerQueue();
    const repository = getCharacterImageSubmissionRepository();
    for (let index = 0; index < 4; index += 1) {
      const job = await queue.claim();
      if (!job) return new NextResponse(null, {status: 204});
      let submission = await repository.get(job.requestKey);
      if (!submission || submission.projectId !== job.projectId || submission.characterId !== job.characterId) {
        await queue.update(job.requestKey, job.leaseToken, 'failed', {lastError: 'Submission record is missing or mismatched.'});
        continue;
      }
      if (job.providerJobId && (!submission.providerJobId || submission.providerJobId === job.providerJobId)) {
        submission = await repository.recordProviderReceipt(job.requestKey, job.providerJobId);
      }
      if (submission.status === 'completed' || submission.status === 'failed' || submission.status === 'uncertain') {
        await queue.update(job.requestKey, job.leaseToken, submission.status, {providerJobId: submission.providerJobId, lastError: submission.lastError});
        continue;
      }
      const referenceUrls = await Promise.all(job.styleReferenceImageIds.map(async (assetId) => {
        const asset = await getCharacterImageBlobAsset(assetId);
        if (!asset || asset.projectId !== job.projectId || asset.styleLineage?.styleBibleHash !== job.styleBibleHash) throw new Error('Worker style reference is unavailable or mismatched.');
        const token = createAssetCapability(job.projectId, assetId, 600);
        return `${request.nextUrl.origin}/api/projects/${encodeURIComponent(job.projectId)}/assets/${encodeURIComponent(assetId)}?token=${encodeURIComponent(token)}`;
      }));
      return NextResponse.json({job, referenceUrls, resumeProviderJobId: submission.providerJobId});
    }
    return new NextResponse(null, {status: 204});
  } catch (error) {
    console.error('Higgsfield worker claim failed.', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown worker claim error',
    });
    return fail(authorized ? 400 : 401);
  }
}

export async function POST(request: NextRequest) {
  try {
    authorizeAgentRequest(request);
    const form = await request.formData();
    const action = String(form.get('action') ?? '');
    const requestKey = String(form.get('requestKey') ?? '');
    const providerJobId = String(form.get('providerJobId') ?? '');
    const leaseToken = String(form.get('leaseToken') ?? '');
    if (!HEX64.test(requestKey)) throw new Error('Invalid request key.');
    const repository = getCharacterImageSubmissionRepository();
    const queue = createCharacterImageWorkerQueue();
    const submission = await repository.get(requestKey);
    if (!submission) throw new Error('Submission not found.');

    if (action === 'prepare') {
      if (!UUID.test(leaseToken)) throw new Error('Invalid worker lease.');
      if (submission.providerJobId) return NextResponse.json({ok: true, providerReceiptAlreadyRecorded: true});
      await queue.prepareSubmit(requestKey, leaseToken);
      await repository.markUncertain(
        requestKey,
        'Paid provider submission prepared; automatic resubmission is locked until a provider receipt is recorded.',
      );
      return NextResponse.json({ok: true});
    }

    if (action === 'receipt') {
      if (!UUID.test(providerJobId) || !UUID.test(leaseToken)) throw new Error('Invalid worker receipt.');
      await queue.recordReceipt(requestKey, leaseToken, providerJobId);
      await repository.recordProviderReceipt(requestKey, providerJobId);
      return NextResponse.json({ok: true});
    }
    if (action === 'uncertain') {
      const reason = String(form.get('reason') ?? 'CLI provider submission result is uncertain.').slice(0, 4000);
      const validProviderJobId = UUID.test(providerJobId) ? providerJobId : undefined;
      if (validProviderJobId && submission.providerJobId === validProviderJobId && submission.status === 'queued') {
        const queuedJob = await queue.get(requestKey);
        if (queuedJob?.status === 'submitted' && queuedJob.providerJobId === validProviderJobId) {
          return NextResponse.json({ok: true, receiptAlreadyRecorded: true});
        }
      }
      await repository.markUncertain(requestKey, reason, validProviderJobId);
      await queue.update(requestKey, UUID.test(leaseToken) ? leaseToken : undefined, 'uncertain', {providerJobId: validProviderJobId, lastError: reason});
      return NextResponse.json({ok: true});
    }
    if (action === 'failed') {
      if (!UUID.test(providerJobId) || submission.providerJobId !== providerJobId) throw new Error('Provider receipt mismatch.');
      const reason = String(form.get('reason') ?? 'Provider generation failed.').slice(0, 4000);
      await repository.markFailed(requestKey, reason);
      await queue.update(requestKey, undefined, 'failed', {providerJobId, lastError: reason});
      return NextResponse.json({ok: true});
    }
    if (action === 'complete') {
      if (!UUID.test(providerJobId) || submission.providerJobId !== providerJobId) throw new Error('Provider receipt mismatch.');
      const file = form.get('file');
      if (!(file instanceof File) || file.size > HIGGSFIELD_WORKER_UPLOAD_MAX_BYTES) throw new Error('Generated image file is missing or too large.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const asset = await ingestCharacterImageBlob({
        projectId: submission.projectId,
        requestKey,
        providerJobId,
        bytes,
        styleLineage: {styleBibleHash: submission.styleBibleHash, styleReferenceImageIds: submission.styleReferenceImageIds},
      });
      await repository.markCompleted(requestKey, asset.id);
      await queue.update(requestKey, undefined, 'completed', {providerJobId});
      return NextResponse.json({ok: true, assetId: asset.id, contentSha256: asset.contentSha256});
    }
    throw new Error('Unknown worker action.');
  } catch (error) {
    console.error('Higgsfield worker update failed.', {name: error instanceof Error ? error.name : 'UnknownError'});
    return fail(request.headers.has('authorization') ? 400 : 401);
  }
}
