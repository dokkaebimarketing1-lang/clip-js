import {createHash} from 'node:crypto';
import {copyFileSync, mkdtempSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
vi.mock('server-only', () => ({}));
import {initialState} from '@/app/store/slices/projectSlice';
import {approveCreative} from '@/app/lib/workflow/approval';
import {sha256} from '@/app/lib/workflow/hash';
import {signCreativeApproval, signTakeApproval} from '@/app/lib/security/approval-signature';
import {createGenerationAuthorizationPreview, issueGenerationAuthorization} from '@/app/lib/byteplus/generation-authorization.server';
import {createFilesystemGenerationRepository} from './generation-repository.server';
import {FakeGenerationProvider} from './provider';
import {submitAuthorizedGeneration} from './submit-generation.server';
import {runGenerationWorkerTick} from './generation-worker.server';
import {createLocalGeneratedAssetStore} from '@/app/lib/assets/generated-asset-store.server';
import {createSecureBytePlusResultIngestor} from '@/app/lib/assets/secure-byteplus-ingest.server';
import {getGeneratedAssetStore} from './runtime.server';
import {renderApprovedProject} from '@/app/lib/render/remotion';
import {probeAndDecodeGeneratedVideo} from '@/app/lib/render/media-probe';
import {prepareApprovedTakeImport, upsertQcPendingTake} from '@/app/lib/workflow/generated-take';
import type {ProjectState} from '@/app/types';

const roots: string[] = [];
const root = () => { const value = mkdtempSync(join(tmpdir(), 'clipjs-fake-e2e-')); roots.push(value); return value; };
afterEach(() => { while (roots.length) rmSync(roots.pop()!, {recursive: true, force: true}); });
beforeAll(() => { process.env.CLIPJS_APPROVAL_SIGNING_SECRET = 'fake-e2e-signing-secret'; });

const project = async (): Promise<ProjectState> => {
  const value = structuredClone(initialState);
  value.id = 'fake-e2e-project'; value.projectName = 'Fake E2E'; value.duration = 30;
  const referenceStore = createLocalGeneratedAssetStore({rootDirectory: root(), minFreeBytes: 0, getFreeBytes: () => 1_000_000});
  (globalThis as typeof globalThis & {__clipjsGeneratedAssetStore?: typeof referenceStore}).__clipjsGeneratedAssetStore = referenceStore;
  const referenceBytes = Buffer.from('fake-character-reference');
  const referenceHash = createHash('sha256').update(referenceBytes).digest('hex');
  const referenceTemp = referenceStore.createTempPath('fake-character');
  writeFileSync(referenceTemp, referenceBytes);
  const reference = await referenceStore.commitVerifiedTemp({tempPath: referenceTemp, projectId: value.id, requestKey: 'b'.repeat(64), contentSha256: referenceHash, byteLength: referenceBytes.length, mimeType: 'image/png', assetKind: 'managed-media', media: {format: 'png', width: 1280, height: 720}});
  const styleBible = {visualMedium: 'cinematic photography', realism: 'natural', renderLanguage: 'live action', proportionRules: 'natural anatomy', lighting: 'soft daylight', lensAndDepth: '50mm', background: 'coherent studio', textureAndColor: 'natural texture', negativeConstraints: ['no style drift']};
  const styleBibleHash = await sha256(styleBible);
  await referenceStore.setStyleLineage(reference.asset.id, value.id, {styleBibleHash, styleReferenceImageIds: []});
  const characterSheet = {id: 'CHAR01', name: 'Subject', palette: {dominant: '#241818', secondary: '#6f3434', accent: '#f0b45c'}, visualTags: ['fictional subject'], referenceImageId: reference.asset.id, referenceStyleHash: styleBibleHash};
  value.workflow.styleBible = styleBible;
  value.workflow.styleBibleHash = styleBibleHash;
  value.workflow.characterSheet = characterSheet;
  value.workflow.characterSheets = [characterSheet];
  value.workflow.storyboard = {version: 'v1', title: 'Fake E2E', noBgm: true, characterReferenceIds: [reference.asset.id], styleBibleHash, cuts: [{id: 'CUT01', title: 'Cut', characterIds: ['CHAR01'], absoluteStartSeconds: 0, absoluteEndSeconds: 30, shots: [{id: 'S1', startSeconds: 0, endSeconds: 30, startFrame: 'studio wide', endFrame: 'subject settles', camera: 'locked camera', action: 'subject moves naturally', dialogue: '—', sfx: 'quiet room tone'}]}]};
  const stressTests = Array.from({length: 10}, (_, index) => ({id: `stress-${index + 1}`, pose: `pose-${index + 1}`, lighting: index % 2 ? 'night' : 'day', coAssetIds: [], resultAssetId: `result-${index + 1}`, verdict: 'pass' as const}));
  value.workflow.production = {
    assets: [{id: 'asset-1', tag: '@subject', type: 'character', state: 'base', descriptor: 'fictional subject', referenceUrl: 'https://assets.example.test/subject.png', referenceHash: 'a'.repeat(64), editMode: 'original', status: 'locked', stressTests}],
    continuityLocks: [{id: 'lock-1', sceneId: 'CUT01', status: 'locked', landmarks: [{id: 'desk', description: 'plain desk', frameRegion: 'center'}], cameraSide: 'south', axisRule: 'do not cross axis', lightSource: 'soft window', shadowDirection: 'left', palette: {dominant: '#241818', secondary: '#6f3434', accent: '#f0b45c'}}],
    shotSpecs: [{id: 'spec-1', cutId: 'CUT01', shotId: 'S1', durationSeconds: 30, characterCount: 1, format: 'single-take', activeReferences: [{assetId: 'asset-1', role: 'identity'}], continuityLockId: 'lock-1', firstFrameBlocking: [{subject: '@subject', position: 'center', action: 'waits'}], optics: '35mm', camera: ['locked'], actionBeats: [{startSeconds: 0, endSeconds: 30, action: 'natural action'}], physics: ['natural inertia'], lighting: {source: 'window', direction: 'right', preserveContinuity: true}, audio: {dialogue: '—', ambience: 'room', sfx: 'cloth'}, acting: [{assetId: 'asset-1', beats: ['eyes before head']}], positiveConstraints: ['one subject', 'no readable text']}],
    takes: [],
  };
  value.workflow.seedanceMaster.duration = 30;
  const creative = await approveCreative(value.workflow.storyboard!, 'owner', new Date('2026-08-11T00:00:00Z'), [characterSheet]);
  value.workflow.creativeApproval = signCreativeApproval(value.id, creative);
  const preview = await createGenerationAuthorizationPreview(value, 'attempt-fake-e2e');
  const issued = await issueGenerationAuthorization(value, 'attempt-fake-e2e', preview.requestHash, 'owner', new Date('2026-08-11T00:01:00Z'));
  value.workflow.generationApproval = issued.generationApproval;
  return value;
};

describe('fake provider full pipeline', () => {
  it('submits once and imports exactly one approved placement', async () => {
    let value = await project();
    const repository = createFilesystemGenerationRepository({rootDirectory: root()});
    const provider = new FakeGenerationProvider();
    await submitAuthorizedGeneration({project: value, repository, provider, allowProviderSubmit: true});
    await submitAuthorizedGeneration({project: value, repository, provider, allowProviderSubmit: true});
    expect(provider.submissions).toHaveLength(1);

    const assetStore = createLocalGeneratedAssetStore({rootDirectory: root(), minFreeBytes: 0, getFreeBytes: () => 1_000_000});
    const ingestResult = async ({projectId, requestKey, providerJobId}: {projectId: string; requestKey: string; providerJobId: string}) => {
      const bytes = Buffer.from('fake-provider-verified-video-bytes');
      const sha = createHash('sha256').update(bytes).digest('hex');
      const temp = assetStore.createTempPath('fake-result'); writeFileSync(temp, bytes);
      const committed = await assetStore.commitVerifiedTemp({tempPath: temp, projectId, requestKey, providerJobId, contentSha256: sha, byteLength: bytes.length, mimeType: 'video/mp4', media: {container: 'mp4', videoCodec: 'h264', width: 1280, height: 720, fps: 24, durationSeconds: 30, videoStreams: 1, audioStreams: 0}});
      return {assetId: committed.asset.id, contentSha256: committed.asset.contentSha256, actualDurationSeconds: 30};
    };
    await runGenerationWorkerTick({repository, provider, workerId: 'fake-worker', now: new Date('2026-08-11T00:02:00Z'), ingestResult});
    await runGenerationWorkerTick({repository, provider, workerId: 'fake-worker', now: new Date('2026-08-11T00:02:10Z'), ingestResult});
    const [ready] = await repository.listProject(value.id);
    expect(ready.job.status).toBe('ready');
    for (let index = 0; index < 10; index += 1) value = upsertQcPendingTake(value, ready);
    expect(value.workflow.production.takes).toHaveLength(1);
    expect(value.mediaFiles).toHaveLength(0);
    if (ready.job.status !== 'ready') throw new Error('ready job required');
    const unsigned = {status: 'approved' as const, takeId: ready.job.takeId, assetId: ready.job.assetId, contentSha256: ready.job.contentSha256, approvedAt: '2026-08-11T00:03:00.000Z', approvedBy: 'owner'};
    const approval = signTakeApproval(value.id, unsigned);
    for (let index = 0; index < 10; index += 1) value = prepareApprovedTakeImport(value, ready.job.takeId, approval, ready.job.actualDurationSeconds);
    expect(value.workflow.production.takes).toHaveLength(1);
    expect(value.workflow.production.takes[0].qcStatus).toBe('approved');
    expect(value.mediaFiles).toHaveLength(1);
    expect(value.mediaFiles[0].source).toEqual({kind: 'generated', generatedAssetId: ready.job.assetId});
  });

  it.skipIf(process.env.CLIPJS_RUN_FULL_FAKE_E2E !== '1' || !process.env.REMOTION_BROWSER_EXECUTABLE_PATH)(
    'runs fake submission through real ffprobe/decode, asset staging, Remotion, and final MP4 probe',
    async () => {
      const workspace = root();
      const sourceVideo = join(workspace, 'fake-provider-source.mp4');
      execFileSync(process.env.CLIPJS_FFMPEG_PATH || 'ffmpeg', [
        '-y', '-f', 'lavfi', '-i', 'color=c=0x203040:s=1280x720:r=24', '-t', '30',
        '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', sourceVideo,
      ], {stdio: 'ignore'});
      process.env.CLIPJS_GENERATED_ASSET_DIR = join(workspace, 'assets');
      process.env.CLIPJS_RENDER_OUTPUT_DIR = join(workspace, 'renders');
      process.env.CLIPJS_REMOTION_BUNDLE_DIR = join(process.cwd(), 'remotion-bundle');
      delete (globalThis as typeof globalThis & {__clipjsGeneratedAssetStore?: unknown}).__clipjsGeneratedAssetStore;

      let value = await project();
      const repository = createFilesystemGenerationRepository({rootDirectory: join(workspace, 'jobs')});
      const provider = new FakeGenerationProvider();
      await submitAuthorizedGeneration({project: value, repository, provider, allowProviderSubmit: true});
      const assetStore = getGeneratedAssetStore();
      const ingestResult = createSecureBytePlusResultIngestor({
        assetStore,
        allowedHosts: ['results.example.com'],
        download: async (_url, destinationBase) => {
          const destination = `${destinationBase}.mp4`;
          copyFileSync(sourceVideo, destination);
          return {filename: destination.split(/[\\/]/).pop()!, bytes: statSync(destination).size};
        },
      });
      await runGenerationWorkerTick({repository, provider, workerId: 'full-fake-worker', now: new Date('2026-08-11T00:02:00Z'), ingestResult});
      await runGenerationWorkerTick({repository, provider, workerId: 'full-fake-worker', now: new Date('2026-08-11T00:02:10Z'), ingestResult});
      const [ready] = await repository.listProject(value.id);
      if (ready.job.status !== 'ready') throw new Error('ready job required');
      value = upsertQcPendingTake(value, ready);
      const approval = signTakeApproval(value.id, {
        status: 'approved', takeId: ready.job.takeId, assetId: ready.job.assetId,
        contentSha256: ready.job.contentSha256, approvedAt: '2026-08-11T00:03:00.000Z', approvedBy: 'owner',
      });
      value = prepareApprovedTakeImport(value, ready.job.takeId, approval, ready.job.actualDurationSeconds);
      const rendered = await renderApprovedProject(value);
      const metadata = await probeAndDecodeGeneratedVideo(rendered.outputLocation, 30);
      expect(metadata).toMatchObject({width: 1920, height: 1080, videoStreams: 1});
      expect(provider.submissions).toHaveLength(1);
    },
    360_000,
  );
});
