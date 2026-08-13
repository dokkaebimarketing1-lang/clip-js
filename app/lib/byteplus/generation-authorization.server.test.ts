import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
vi.mock('server-only', () => ({}));
import {initialState} from '@/app/store/slices/projectSlice';
import {approveCreative} from '@/app/lib/workflow/approval';
import {signCreativeApproval, verifyGenerationApprovalSignature} from '@/app/lib/security/approval-signature';
import {generationApprovalSchema, type Storyboard} from '@/app/lib/workflow/schema';
import type {ProductionManifest} from '@/app/lib/workflow/production-schema';
import {createGenerationAuthorizationPreview, issueGenerationAuthorization} from './generation-authorization.server';
import {createFilesystemGenerationRepository} from '@/app/lib/generation/generation-repository.server';
import {FakeGenerationProvider} from '@/app/lib/generation/provider';
import {submitAuthorizedGeneration} from '@/app/lib/generation/submit-generation.server';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const getAsset = vi.fn();
vi.mock('@/app/lib/generation/runtime.server', () => ({
  getGeneratedAssetStore: () => ({get: getAsset}),
}));

const temporaryDirectories: string[] = [];
const repository = () => {
  const directory = mkdtempSync(join(tmpdir(), 'clipjs-submit-'));
  temporaryDirectories.push(directory);
  return createFilesystemGenerationRepository({rootDirectory: directory});
};
afterEach(() => temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, {recursive: true, force: true})));

beforeAll(() => {
  process.env.CLIPJS_APPROVAL_TOKEN = 'unit-test-owner-token';
  process.env.CLIPJS_APPROVAL_SIGNING_SECRET = 'unit-test-signing-secret';
});

const referenceImageId = `ga_${'a'.repeat(32)}`;
const characterSheet = {id: 'CHAR01', name: 'Person', palette: {dominant: '#111111', secondary: '#222222', accent: '#333333'}, visualTags: ['consistent'], referenceImageId};
const storyboard: Storyboard = {version: 'v1', title: 'Auth fixture', noBgm: true, characterReferenceIds: [referenceImageId], cuts: [{id: 'CUT01', title: 'Cut', characterIds: ['CHAR01'], absoluteStartSeconds: 0, absoluteEndSeconds: 30, shots: [{id: 'S1', startSeconds: 0, endSeconds: 30, startFrame: 'wide room', endFrame: 'relieved person', camera: 'push', action: 'listen', dialogue: '—', sfx: 'room'}]}]};
const production: ProductionManifest = {
  assets: [],
  continuityLocks: [{id: 'lock-1', sceneId: 'CUT01', status: 'locked', landmarks: [], cameraSide: 'south', axisRule: 'stay south', lightSource: 'window', shadowDirection: 'left', palette: {dominant: '#111111', secondary: '#222222', accent: '#333333'}}],
  shotSpecs: [{id: 'spec-1', cutId: 'CUT01', shotId: 'S1', durationSeconds: 30, characterCount: 0, format: 'single-take', activeReferences: [], continuityLockId: 'lock-1', firstFrameBlocking: [], optics: '35mm', camera: ['slow push'], actionBeats: [{startSeconds: 0, endSeconds: 30, action: 'hold'}], physics: [], lighting: {source: 'window', direction: 'left', preserveContinuity: true}, audio: {dialogue: '—', ambience: 'room', sfx: 'none'}, acting: [], positiveConstraints: ['no readable text']}],
  takes: [],
};

const project = async () => {
  getAsset.mockResolvedValue({id: referenceImageId, projectId: 'project-auth', state: 'ready', mimeType: 'image/png'});
  const value = structuredClone(initialState);
  value.id = 'project-auth';
  value.projectName = 'Authorization test';
  value.workflow.storyboard = storyboard;
  value.workflow.characterSheet = characterSheet;
  value.workflow.characterSheets = [characterSheet];
  value.workflow.production = production;
  value.workflow.creativeApproval = signCreativeApproval(value.id, await approveCreative(storyboard, 'owner', new Date('2026-08-11T00:00:00Z'), [characterSheet]));
  return value;
};

describe('GenerationAuthorization', () => {
  it('keeps request identity stable across signatures while a new attempt changes it', async () => {
    const value = await project();
    const preview = await createGenerationAuthorizationPreview(value, 'attempt-1');
    const first = await issueGenerationAuthorization(value, 'attempt-1', preview.requestHash, 'owner', new Date('2026-08-11T01:00:00Z'));
    const second = await issueGenerationAuthorization(value, 'attempt-1', preview.requestHash, 'owner', new Date('2026-08-11T02:00:00Z'));
    expect(first.preview.requestKey).toBe(second.preview.requestKey);
    expect(first.generationApproval.signature).not.toBe(second.generationApproval.signature);
    verifyGenerationApprovalSignature(value.id, first.generationApproval);
    const nextAttempt = await createGenerationAuthorizationPreview(value, 'attempt-2');
    expect(nextAttempt.requestKey).not.toBe(preview.requestKey);
  });

  it('rejects stale previews, project-scope replay, and incomplete approved authorization records', async () => {
    const value = await project();
    const preview = await createGenerationAuthorizationPreview(value, 'attempt-1');
    const changed = structuredClone(value);
    changed.workflow.production.shotSpecs[0].camera = ['handheld orbit'];
    await expect(issueGenerationAuthorization(changed, 'attempt-1', preview.requestHash)).rejects.toThrow(/changed after preview/i);
    const issued = await issueGenerationAuthorization(value, 'attempt-1', preview.requestHash);
    expect(() => verifyGenerationApprovalSignature('another-project', issued.generationApproval)).toThrow(/project scope/i);
    expect(generationApprovalSchema.safeParse({status: 'approved'}).success).toBe(false);
  });

  it('rejects legacy storyboard provenance and reference assets owned by another project', async () => {
    const legacy = await project();
    legacy.workflow.storyboard = {...storyboard, characterReferenceIds: undefined};
    legacy.workflow.creativeApproval = signCreativeApproval(legacy.id, await approveCreative(legacy.workflow.storyboard, 'owner', new Date('2026-08-11T00:00:00Z'), [characterSheet]));
    await expect(createGenerationAuthorizationPreview(legacy, 'attempt-legacy')).rejects.toThrow(/reference lineage/i);

    const wrongOwner = await project();
    getAsset.mockResolvedValue({id: referenceImageId, projectId: 'another-project', state: 'ready', mimeType: 'image/png'});
    await expect(createGenerationAuthorizationPreview(wrongOwner, 'attempt-wrong-owner')).rejects.toThrow(/reference asset/i);
  });

  it('submits one provider task per authorized request and locks unknown outcomes as uncertain', async () => {
    const value = await project();
    const preview = await createGenerationAuthorizationPreview(value, 'attempt-submit');
    const issued = await issueGenerationAuthorization(value, 'attempt-submit', preview.requestHash);
    value.workflow.generationApproval = issued.generationApproval;
    const repo = repository();
    const fake = new FakeGenerationProvider();
    const first = await submitAuthorizedGeneration({project: value, repository: repo, provider: fake, allowProviderSubmit: true});
    const second = await submitAuthorizedGeneration({project: value, repository: repo, provider: fake, allowProviderSubmit: true});
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(fake.submissions).toHaveLength(1);

    const uncertainValue = await project();
    const uncertainPreview = await createGenerationAuthorizationPreview(uncertainValue, 'attempt-uncertain');
    const uncertainIssued = await issueGenerationAuthorization(uncertainValue, 'attempt-uncertain', uncertainPreview.requestHash);
    uncertainValue.workflow.generationApproval = uncertainIssued.generationApproval;
    let submitCalls = 0;
    const uncertainProvider = {
      createTask: async () => { submitCalls += 1; throw new Error('connection reset after request write'); },
      retrieveTask: async () => { throw new Error('not used'); },
    };
    await expect(submitAuthorizedGeneration({project: uncertainValue, repository: repo, provider: uncertainProvider, allowProviderSubmit: true})).rejects.toThrow(/connection reset/i);
    const recovered = await submitAuthorizedGeneration({project: uncertainValue, repository: repo, provider: uncertainProvider, allowProviderSubmit: true});
    expect(recovered.record.job.status).toBe('uncertain');
    expect(submitCalls).toBe(1);
  });
});
