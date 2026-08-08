import {describe, expect, it} from 'vitest';
import {approveStoryboard, assertVideoGenerationAllowed, ApprovalRequiredError, invalidateApproval} from './approval';
import {createDefaultWorkflow, type Storyboard} from './schema';
import {approveAgentChange, previewAgentCommand} from '../agent/commands';
import {assertSafeRemoteUrl, isHostnameAllowed} from '../security/remote-url';
import projectReducer, {initialState, rehydrate, setMediaFiles, setWorkflow} from '@/app/store/slices/projectSlice';
import {importProjectIntoCurrentProject, parseRenderProjectRequest} from './project-file';
import {assertRenderLimits} from '../render/limits';
import {createRenderDownloadToken, verifyRenderDownloadToken} from '../security/api-auth';
import {normalizeRenderDownloadUrl} from '../render/download-url';

const storyboard: Storyboard = {
  version: 'v1', title: 'Approved test', noBgm: true,
  cuts: [{id: 'CUT01', title: 'Opening', absoluteStartSeconds: 0, absoluteEndSeconds: 2, shots: [{id: 'S1', startSeconds: 0, endSeconds: 2, startFrame: 'dark room', endFrame: 'door opens', camera: 'wide push', action: 'open', dialogue: '—', sfx: 'door'}]}],
};

describe('storyboard approval gate', () => {
  it('fails closed before explicit approval', async () => {
    const workflow = {...createDefaultWorkflow(), storyboard};
    await expect(assertVideoGenerationAllowed(workflow)).rejects.toBeInstanceOf(ApprovalRequiredError);
  });
  it('allows only the exact approved storyboard hash', async () => {
    const approval = await approveStoryboard(storyboard, 'owner', new Date('2026-01-01T00:00:00Z'));
    await expect(assertVideoGenerationAllowed({...createDefaultWorkflow(), storyboard, approval})).resolves.toBeUndefined();
    await expect(assertVideoGenerationAllowed({...createDefaultWorkflow(), storyboard: {...storyboard, title: 'changed'}, approval})).rejects.toThrow('changed after approval');
    expect(invalidateApproval(approval).status).toBe('invalidated');
  });
});

describe('agent preview/apply', () => {
  it('requires the exact preview token', async () => {
    const project = structuredClone(initialState);
    project.id = 'project-1';
    const change = await previewAgentCommand(project, {type: 'add_caption', text: '안녕하세요', startSeconds: 0, endSeconds: 1, preset: 'shorts'});
    await expect(approveAgentChange(project, change, 'wrong')).rejects.toThrow('invalid or stale');
    const staleProject = {...project, projectName: 'Edited after preview'};
    await expect(approveAgentChange(staleProject, change, change.token)).rejects.toThrow('preview is stale');
    const runtimeOnlyChange = {...project, currentTime: 0.5, isPlaying: true};
    await expect(approveAgentChange(runtimeOnlyChange, change, change.token)).resolves.toBeDefined();
    const applied = await approveAgentChange(project, change, change.token);
    expect(applied.workflow.captions[0].text).toBe('안녕하세요');
  });

  it('adds a bounded Korean variety caption through preview/apply', async () => {
    const project = {...structuredClone(initialState), id: 'caption-variety'};
    const change = await previewAgentCommand(project, {
      type: 'add_caption',
      text: '이게 된다고?!',
      startSeconds: 1,
      endSeconds: 2,
      kind: 'variety',
      preset: 'variety-shock',
      position: 'center',
      intensity: 0.7,
      accentColor: '#ffd43b',
    });
    expect(change.proposedProject.workflow.captions[0]).toMatchObject({
      kind: 'variety', preset: 'variety-shock', position: 'center', intensity: 0.7,
      accentColor: '#ffd43b', fontFamily: 'Noto Sans KR Variable',
    });
    expect(change.proposedProject.workflow.captions[0].wordTimings).toHaveLength(2);
  });

  it('rejects a caption whose end is not after its start during preview', async () => {
    const project = {...structuredClone(initialState), id: 'caption-range'};
    await expect(previewAgentCommand(project, {type: 'add_caption', text: '잘못된 범위', startSeconds: 2, endSeconds: 2, preset: 'clean'})).rejects.toThrow('Caption end must be after start.');
  });

  it('adds a bounded visual effect through agent preview and rejects audio targets', async () => {
    const project = structuredClone(initialState);
    project.id = 'project-effect';
    project.mediaFiles = [
      {
        id: 'video-1', fileId: 'video-1', fileName: 'clip.mp4', type: 'video',
        startTime: 0, endTime: 4, positionStart: 1, positionEnd: 5,
        includeInMerge: true, playbackSpeed: 1, volume: 100, zIndex: 1, opacity: 100,
      },
      {
        id: 'audio-1', fileId: 'audio-1', fileName: 'sound.mp3', type: 'audio',
        startTime: 0, endTime: 4, positionStart: 1, positionEnd: 5,
        includeInMerge: true, playbackSpeed: 1, volume: 100, zIndex: 0, opacity: 100,
      },
    ];

    const change = await previewAgentCommand(project, {
      type: 'add_effect', mediaId: 'video-1', effect: 'chromatic-aberration',
      intensity: 0.4, startSeconds: 2, endSeconds: 3,
    });
    expect(change.proposedProject.workflow.effects[0]).toMatchObject({
      targetMediaId: 'video-1', type: 'chromatic-aberration', intensity: 0.4,
      startSeconds: 2, endSeconds: 3, provider: 'remotion',
    });
    await expect(previewAgentCommand(project, {
      type: 'add_effect', mediaId: 'audio-1', effect: 'blur', intensity: 0.5,
    })).rejects.toThrow('visual media');
  });

  it('imports storyboard-mapped Higgsfield SFX at the exact shot frame', async () => {
    const project = structuredClone(initialState);
    project.id = 'project-sfx';
    project.workflow = {...createDefaultWorkflow(), storyboard};
    const change = await previewAgentCommand(project, {
      type: 'import_clip',
      url: 'https://cdn.example.com/hit.mp3',
      model: 'higgsfield-audio',
      cutId: 'CUT01',
      shotId: 'S1',
      role: 'audio',
      durationSeconds: 0.5,
    });
    const applied = await approveAgentChange(project, change, change.token);
    expect(applied.mediaFiles[0]).toMatchObject({type: 'audio', positionStart: 0, storyboardRole: 'audio'});
    expect(applied.workflow.higgsfieldAssets[0].shotId).toBe('S1');
    expect(applied.duration).toBe(0.5);
  });

  it('imports visual clips at the storyboard shot time instead of appending to the timeline', async () => {
    const project = structuredClone(initialState);
    project.id = 'project-visual-map';
    project.workflow = {...createDefaultWorkflow(), storyboard};
    project.mediaFiles = [{
      id: 'existing', fileId: 'existing', fileName: 'existing.mp4', type: 'video',
      startTime: 0, endTime: 4, positionStart: 20, positionEnd: 24,
      includeInMerge: true, playbackSpeed: 1, volume: 100, zIndex: 1, opacity: 100, src: '',
    }];
    const change = await previewAgentCommand(project, {
      type: 'import_clip', url: 'https://cdn.example.com/shot.mp4', model: 'seedance_2_5',
      cutId: 'CUT01', shotId: 'S1', role: 'clip', durationSeconds: 4,
    });
    const applied = await approveAgentChange(project, change, change.token);
    expect(applied.mediaFiles.at(-1)).toMatchObject({type: 'video', positionStart: 0, positionEnd: 4});
  });
});

describe('remote media URL guard', () => {
  it.each([
    'http://example.com/video.mp4',
    'https://localhost/video.mp4',
    'https://127.0.0.1/video.mp4',
    'https://192.168.1.2/video.mp4',
    'https://10.0.0.1/video.mp4',
    'https://172.16.0.1/video.mp4',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/video.mp4',
    'https://[fd00::1]/video.mp4',
    'https://studio.local/video.mp4',
    'https://user:pass@cdn.example.com/video.mp4',
    `https://cdn.example.com/${'x'.repeat(4096)}.mp4`,
  ])('blocks unsafe URL %s', (url) => {
    expect(() => assertSafeRemoteUrl(url)).toThrow();
  });
  it('accepts public HTTPS media', () => {
    expect(assertSafeRemoteUrl('https://cdn.example.com/video.mp4').hostname).toBe('cdn.example.com');
  });
  it('uses exact and wildcard media host allowlists without suffix confusion', () => {
    expect(isHostnameAllowed('cdn.example.com', ['cdn.example.com'])).toBe(true);
    expect(isHostnameAllowed('video.cdn.example.com', ['*.cdn.example.com'])).toBe(true);
    expect(isHostnameAllowed('cdn.example.com.evil.test', ['cdn.example.com'])).toBe(false);
    expect(isHostnameAllowed('cdn.example.com', ['*.cdn.example.com'])).toBe(false);
  });
});

describe('render request contract', () => {
  it('extracts the project wrapper and rejects an unwrapped project', () => {
    const project = {...structuredClone(initialState), id: 'render-project', projectName: 'Render'};
    expect(parseRenderProjectRequest({project}).id).toBe('render-project');
    expect(() => parseRenderProjectRequest(project)).toThrow();
  });
  it('recomputes stale imported duration from actual timeline ranges', () => {
    const project = structuredClone(initialState);
    project.id = 'stale-duration';
    project.projectName = 'Stale';
    project.duration = 999;
    project.workflow.captions = [{id: 'cue', text: 'caption', startSeconds: 1, endSeconds: 3, kind: 'dialogue', preset: 'clean', position: 'bottom', intensity: 0.5, accentColor: '#ffd43b', fontFamily: 'Noto Sans KR Variable', wordTimings: [], emphasis: [], safeArea: true}];
    expect(parseRenderProjectRequest({project}).duration).toBe(3);
  });
  it('imports another project into the open project ID and invalidates its approval', () => {
    const imported = structuredClone(initialState);
    imported.id = 'exported-project';
    imported.projectName = 'Imported';
    imported.workflow = {
      ...createDefaultWorkflow(),
      storyboard,
      approval: {status: 'approved', storyboardHash: 'hash', signature: 'signature'},
    };
    const normalized = importProjectIntoCurrentProject(imported, 'open-project');
    expect(normalized.id).toBe('open-project');
    expect(normalized.projectName).toBe('Imported');
    expect(normalized.workflow.approval.status).toBe('invalidated');

    const rehydrated = projectReducer({...structuredClone(initialState), id: 'open-project', projectName: 'Open'}, rehydrate(normalized));
    expect(rehydrated.id).toBe('open-project');
    expect(rehydrated.projectName).toBe('Imported');
    expect(rehydrated.workflow.approval.status).toBe('invalidated');
  });
  it('rejects transitions with missing, nonvisual, reversed, or identical endpoints', () => {
    const project = {...structuredClone(initialState), id: 'transition-integrity', projectName: 'Transitions'};
    project.mediaFiles = [
      {id: 'first', fileId: 'first', fileName: 'first.mp4', type: 'video', startTime: 0, endTime: 2, positionStart: 0, positionEnd: 2, includeInMerge: true, playbackSpeed: 1, volume: 100, zIndex: 1, opacity: 100},
      {id: 'second', fileId: 'second', fileName: 'second.mp4', type: 'video', startTime: 0, endTime: 2, positionStart: 2, positionEnd: 4, includeInMerge: true, playbackSpeed: 1, volume: 100, zIndex: 1, opacity: 100},
      {id: 'audio', fileId: 'audio', fileName: 'audio.mp3', type: 'audio', startTime: 0, endTime: 4, positionStart: 0, positionEnd: 4, includeInMerge: true, playbackSpeed: 1, volume: 100, zIndex: 0, opacity: 100},
      {id: 'unknown', fileId: 'unknown', fileName: 'unknown.bin', type: 'unknown', startTime: 0, endTime: 4, positionStart: 4, positionEnd: 8, includeInMerge: true, playbackSpeed: 1, volume: 100, zIndex: 0, opacity: 100},
    ];
    const transition = {id: 't', fromMediaId: 'first', toMediaId: 'second', type: 'fade' as const, provider: 'native' as const, durationSeconds: 0.5};
    project.workflow.transitions = [transition];
    expect(() => parseRenderProjectRequest({project})).not.toThrow();
    project.workflow.transitions = [{...transition, toMediaId: 'missing'}];
    expect(() => parseRenderProjectRequest({project})).toThrow('missing media');
    project.workflow.transitions = [{...transition, toMediaId: 'audio'}];
    expect(() => parseRenderProjectRequest({project})).toThrow('visual media');
    project.workflow.transitions = [{...transition, toMediaId: 'unknown'}];
    expect(() => parseRenderProjectRequest({project})).toThrow('visual media');
    project.workflow.transitions = [{...transition, fromMediaId: 'second', toMediaId: 'first'}];
    expect(() => parseRenderProjectRequest({project})).toThrow('timeline order');
    project.workflow.transitions = [{...transition, toMediaId: 'first'}];
    expect(() => parseRenderProjectRequest({project})).toThrow('distinct');
  });

  it('rejects duplicate media IDs before resolving effects or transitions', () => {
    const project = {...structuredClone(initialState), id: 'duplicate-media', projectName: 'Duplicate media'};
    const media = {id: 'same', fileId: 'first', fileName: 'first.mp4', type: 'video' as const, startTime: 0, endTime: 2, positionStart: 0, positionEnd: 2, includeInMerge: true, playbackSpeed: 1, volume: 100, zIndex: 1, opacity: 100};
    project.mediaFiles = [media, {...media, fileId: 'second', fileName: 'second.mp4'}];
    expect(() => parseRenderProjectRequest({project})).toThrow('Duplicate media ID');
  });
  it('rejects excessive render duration, fps, and resolution', () => {
    const project = {...structuredClone(initialState), id: 'limits', projectName: 'Limits', duration: 1};
    expect(() => assertRenderLimits(project)).not.toThrow();
    expect(() => assertRenderLimits({...project, duration: 3601})).toThrow('duration');
    expect(() => assertRenderLimits({...project, fps: 120})).toThrow('fps');
    expect(() => assertRenderLimits({...project, resolution: {width: 7680, height: 4320}})).toThrow('resolution');
  });
  it('rejects overlapping captions in the same visual lane', () => {
    const project = {...structuredClone(initialState), id: 'caption-collision', projectName: 'Collision', duration: 3};
    project.workflow.captions = [
      {id: 'first', text: '첫 번째', startSeconds: 1, endSeconds: 2, kind: 'dialogue', preset: 'dialogue-clean', position: 'bottom', intensity: 0.5, accentColor: '#ffd43b', fontFamily: 'Noto Sans KR Variable', wordTimings: [], emphasis: [], safeArea: true},
      {id: 'second', text: '두 번째', startSeconds: 1.5, endSeconds: 2.5, kind: 'dialogue', preset: 'dialogue-cinematic', position: 'bottom', intensity: 0.5, accentColor: '#ffd43b', fontFamily: 'Noto Sans KR Variable', wordTimings: [], emphasis: [], safeArea: true},
    ];
    expect(() => assertRenderLimits(project)).toThrow('overlap in the bottom caption lane');
  });
  it('allows simultaneous captions in different visual lanes', () => {
    const project = {...structuredClone(initialState), id: 'caption-lanes', projectName: 'Lanes', duration: 3};
    project.workflow.captions = [
      {id: 'dialogue', text: '대사', startSeconds: 1, endSeconds: 2, kind: 'dialogue', preset: 'dialogue-clean', position: 'bottom', intensity: 0.5, accentColor: '#ffd43b', fontFamily: 'Noto Sans KR Variable', wordTimings: [], emphasis: [], safeArea: true},
      {id: 'brand', text: '브랜드', startSeconds: 1.5, endSeconds: 2.5, kind: 'dialogue', preset: 'dialogue-cinematic', position: 'top', intensity: 0.5, accentColor: '#ffd43b', fontFamily: 'Noto Sans KR Variable', wordTimings: [], emphasis: [], safeArea: true},
    ];
    expect(() => assertRenderLimits(project)).not.toThrow();
  });
  it('normalizes only same-origin signed render download routes', () => {
    expect(normalizeRenderDownloadUrl('/api/render/file/render-id?expires=1&token=signed', 'https://clip.example')).toBe('/api/render/file/render-id?expires=1&token=signed');
    expect(() => normalizeRenderDownloadUrl('https://evil.example/file.mp4', 'https://clip.example')).toThrow('invalid');
    expect(() => normalizeRenderDownloadUrl('/projects', 'https://clip.example')).toThrow('invalid');
    expect(() => normalizeRenderDownloadUrl('/api/render/file/render-id/extra', 'https://clip.example')).toThrow('invalid');
  });
  it('signs render downloads and rejects tampered tokens', () => {
    const previous = process.env.CLIPJS_RENDER_DOWNLOAD_SECRET;
    process.env.CLIPJS_RENDER_DOWNLOAD_SECRET = 'unit-test-download-secret';
    try {
      const token = createRenderDownloadToken('render-id', 60);
      expect(() => verifyRenderDownloadToken('render-id', token)).not.toThrow();
      expect(() => verifyRenderDownloadToken('other-id', token)).toThrow('invalid');
      expect(() => verifyRenderDownloadToken('render-id', `${token}.ignored-suffix`)).toThrow('invalid');
    } finally {
      if (previous === undefined) delete process.env.CLIPJS_RENDER_DOWNLOAD_SECRET;
      else process.env.CLIPJS_RENDER_DOWNLOAD_SECRET = previous;
    }
  });
});

describe('project reducer workflow invariants', () => {
  it('keeps caption duration when media changes and invalidates changed storyboard approval', () => {
    const base = structuredClone(initialState);
    base.workflow = {
      ...createDefaultWorkflow(), storyboard,
      approval: {status: 'approved', storyboardHash: 'signed-hash'},
      captions: [{id: 'caption', text: '끝', startSeconds: 4, endSeconds: 5, kind: 'dialogue', preset: 'clean', position: 'bottom', intensity: 0.5, accentColor: '#ffd43b', fontFamily: 'Noto Sans KR Variable', wordTimings: [], emphasis: [], safeArea: true}],
    };
    const afterMedia = projectReducer(base, setMediaFiles([]));
    expect(afterMedia.duration).toBe(5);
    const changedStoryboard = {...storyboard, title: 'Changed'};
    const afterStoryboard = projectReducer(afterMedia, setWorkflow({...afterMedia.workflow, storyboard: changedStoryboard, approval: {status: 'approved', storyboardHash: 'forged'}}));
    expect(afterStoryboard.workflow.approval.status).toBe('invalidated');
  });

  it('invalidates approval when production data changes and preserves it for caption-only edits', () => {
    const base = structuredClone(initialState);
    base.workflow = {
      ...createDefaultWorkflow(), storyboard,
      approval: {status: 'approved', storyboardHash: 'signed-hash', productionHash: 'a'.repeat(64)},
    };
    const captionOnly = projectReducer(base, setWorkflow({...base.workflow, captions: [{id: 'cue', text: '끝', startSeconds: 1, endSeconds: 2, kind: 'dialogue', preset: 'clean', position: 'bottom', intensity: 0.5, accentColor: '#ffd43b', fontFamily: 'Noto Sans KR Variable', wordTimings: [], emphasis: [], safeArea: true}]}));
    expect(captionOnly.workflow.approval.status).toBe('approved');
    const changedProduction = {
      ...base.workflow.production,
      assets: [{
        id: 'asset-roco', tag: '@roco', type: 'character' as const, state: 'base', descriptor: 'Roco.',
        referenceUrl: 'https://cdn.example.com/roco.png', referenceHash: 'a'.repeat(64),
        editMode: 'original' as const, status: 'draft' as const, stressTests: [],
      }],
    };
    const afterProduction = projectReducer(base, setWorkflow({...base.workflow, production: changedProduction}));
    expect(afterProduction.workflow.approval.status).toBe('invalidated');
  });
});
