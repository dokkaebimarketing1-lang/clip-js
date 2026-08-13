import 'fake-indexeddb/auto';
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {commitProjectMutation, getProject, listProjectMigrationBackups, ProjectRevisionConflictError, setupDB, storeProject} from './index';
import {initialState} from './slices/projectSlice';

beforeAll(() => {
  vi.stubGlobal('window', globalThis);
});
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe('IndexedDB project revision CAS', () => {
  it('rejects a stale tab instead of overwriting the committed revision', async () => {
    const id = `cas-${crypto.randomUUID()}`;
    const initial = {...structuredClone(initialState), id, projectName: 'base', revision: 0};
    await storeProject(initial);

    const tabA = {...initial, projectName: 'tab-a', revision: 1};
    const tabB = {...initial, projectName: 'tab-b', revision: 1};
    await storeProject(tabA, {expectedRevision: 0});
    await expect(storeProject(tabB, {expectedRevision: 0})).rejects.toBeInstanceOf(ProjectRevisionConflictError);

    const stored = await getProject(id);
    expect(stored?.projectName).toBe('tab-a');
    expect(stored?.revision).toBe(1);
    expect(stored?.projectSchemaVersion).toBe(3);
  });

  it('rejects revision rollback even when no explicit expected revision is supplied', async () => {
    const id = `rollback-${crypto.randomUUID()}`;
    const current = {...structuredClone(initialState), id, projectName: 'current', revision: 4};
    await storeProject(current);
    await expect(storeProject({...current, revision: 3})).rejects.toBeInstanceOf(ProjectRevisionConflictError);
    expect((await getProject(id))?.revision).toBe(4);
  });

  it('returns a mutation only after durable revision commit and rejects a stale retry', async () => {
    const id = `mutation-${crypto.randomUUID()}`;
    const base = {...structuredClone(initialState), id, projectName: 'mutation', revision: 0};
    await storeProject(base);
    const committed = await commitProjectMutation(id, 0, (current) => ({...current, projectName: 'committed'}));
    expect(committed).toMatchObject({revision: 1, projectName: 'committed'});
    await expect(commitProjectMutation(id, 0, (current) => ({...current, projectName: 'stale'}))).rejects.toBeInstanceOf(ProjectRevisionConflictError);
    expect(await getProject(id)).toMatchObject({revision: 1, projectName: 'committed'});
  });

  it('strips signed preview capabilities from IndexedDB project storage', async () => {
    const id = `capability-${crypto.randomUUID()}`;
    const project = {...structuredClone(initialState), id, projectName: 'capability', revision: 0};
    const assetId = `ga_${'a'.repeat(32)}`;
    project.mediaFiles = [{
      id: 'generated-media', fileName: 'generated.mp4', type: 'video',
      source: {kind: 'generated', generatedAssetId: assetId}, generatedAssetId: assetId,
      contentSha256: 'b'.repeat(64),
      remoteUrl: `/api/projects/${id}/assets/${assetId}?token=secret-capability`,
      src: `/api/projects/${id}/assets/${assetId}?token=secret-capability`,
      startTime: 0, endTime: 30, positionStart: 0, positionEnd: 30,
      includeInMerge: true, playbackSpeed: 1, volume: 0, zIndex: 1, opacity: 100,
    }];
    await storeProject(project);
    const loaded = await getProject(id);
    expect(loaded?.mediaFiles[0].src).toBeUndefined();
    expect(loaded?.mediaFiles[0].remoteUrl).toBeUndefined();
  });

  it('backs up a legacy snapshot before returning its migrated v3 projection', async () => {
    const id = `legacy-${crypto.randomUUID()}`;
    const legacy = structuredClone(initialState) as unknown as Record<string, unknown>;
    legacy.id = id;
    legacy.projectName = 'legacy project';
    delete legacy.projectSchemaVersion;
    delete legacy.revision;
    const workflow = legacy.workflow as Record<string, unknown>;
    delete workflow.creativeApproval;
    delete workflow.generationApproval;
    delete workflow.releaseApproval;
    workflow.approval = {status: 'approved', storyboardHash: 'a'.repeat(64), signature: 'b'.repeat(64)};
    const db = await setupDB();
    if (!db) throw new Error('test database unavailable');
    await db.put('projects', legacy);

    const migrated = await getProject(id);
    const migratedAgain = await getProject(id);
    expect(migrated?.projectSchemaVersion).toBe(3);
    expect(migratedAgain?.projectSchemaVersion).toBe(3);
    expect(migrated?.revision).toBe(0);
    expect(migrated?.workflow.generationApproval.status).toBe('invalidated');
    const backups = await listProjectMigrationBackups(id);
    expect(backups).toHaveLength(1);
    expect((backups[0].snapshot as Record<string, unknown>).projectSchemaVersion).toBeUndefined();
    expect((await db.get('projects', id) as Record<string, unknown>).projectSchemaVersion).toBeUndefined();
  });

  it('persists multi-character sheets and per-cut character assignments across reconnect', async () => {
    const id = `multi-${crypto.randomUUID()}`;
    const project = {...structuredClone(initialState), id, projectName: 'multi', revision: 0};
    project.workflow.characterSheet = {id: 'CHAR01', name: '코코', breed: '강아지', palette: {dominant: '#d4a574', secondary: '#8b5a2b', accent: '#4a7c59'}, visualTags: []};
    project.workflow.characterSheets = [
      project.workflow.characterSheet,
      {id: 'CHAR02', name: '토리', breed: '다람쥐', palette: {dominant: '#b87942', secondary: '#f0d2a2', accent: '#5f7c45'}, visualTags: []},
    ];
    project.workflow.storyboard = {
      version: 'v1', title: '함께', noBgm: true,
      cuts: [{id: 'CUT01', title: '함께 등장', characterIds: ['CHAR01', 'CHAR02'], absoluteStartSeconds: 0, absoluteEndSeconds: 5, shots: [{id: 'S1', startSeconds: 0, endSeconds: 5, startFrame: '시작', endFrame: '끝', camera: '고정', action: '함께 걷는다', dialogue: '—', sfx: '숲'}]}],
    };
    await storeProject(project);

    const restored = await getProject(id);

    expect(restored?.workflow.characterSheets?.map((sheet) => sheet.name)).toEqual(['코코', '토리']);
    expect(restored?.workflow.storyboard?.cuts[0].characterIds).toEqual(['CHAR01', 'CHAR02']);
  });

  it('persists cut frame asset links and selected take timeline media across reconnect', async () => {
    const id = `p1-${crypto.randomUUID()}`;
    const project = {...structuredClone(initialState), id, projectName: 'P1', revision: 0};
    project.workflow.storyboard = {
      version: 'v1', title: 'P1', noBgm: true,
      cuts: [{id: 'CUT01', title: 'Opening', absoluteStartSeconds: 0, absoluteEndSeconds: 5, startFrameAssetId: `ga_${'a'.repeat(32)}`, endFrameAssetId: `ga_${'b'.repeat(32)}`, generatedTakeIds: ['take-1'], shots: [{id: 'S1', startSeconds: 0, endSeconds: 5, startFrame: 'start', endFrame: 'end', camera: 'static', action: 'act', dialogue: '—', sfx: 'room'}]}],
    };
    project.mediaFiles = [{id: 'take-media', fileName: 'take.mp4', type: 'video', source: {kind: 'generated', generatedAssetId: `ga_${'c'.repeat(32)}`}, generatedAssetId: `ga_${'c'.repeat(32)}`, takeId: 'take-1', cutId: 'CUT01', shotId: 'S1', storyboardRole: 'clip', contentSha256: 'd'.repeat(64), startTime: 0, endTime: 5, positionStart: 0, positionEnd: 5, includeInMerge: true, playbackSpeed: 1, volume: 100, opacity: 1, zIndex: 1}];
    await storeProject(project);
    const restored = await getProject(id);
    expect(restored?.workflow.storyboard?.cuts[0]).toMatchObject({startFrameAssetId: `ga_${'a'.repeat(32)}`, endFrameAssetId: `ga_${'b'.repeat(32)}`, generatedTakeIds: ['take-1']});
    expect(restored?.mediaFiles[0]).toMatchObject({takeId: 'take-1', cutId: 'CUT01', includeInMerge: true, src: undefined, remoteUrl: undefined});
  });

  it('does not overwrite malformed legacy bytes when migration fails', async () => {
    const id = `malformed-${crypto.randomUUID()}`;
    const malformed = {id, projectName: 'broken', mediaFiles: 'not-an-array'};
    const db = await setupDB();
    if (!db) throw new Error('test database unavailable');
    await db.put('projects', malformed);

    await expect(getProject(id)).rejects.toBeDefined();
    expect(await db.get('projects', id)).toEqual(malformed);
    expect(await listProjectMigrationBackups(id)).toHaveLength(1);
  });
});
