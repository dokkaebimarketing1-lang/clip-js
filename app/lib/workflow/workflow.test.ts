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

  it('rejects a caption whose end is not after its start during preview', async () => {
    const project = {...structuredClone(initialState), id: 'caption-range'};
    await expect(previewAgentCommand(project, {type: 'add_caption', text: '잘못된 범위', startSeconds: 2, endSeconds: 2, preset: 'clean'})).rejects.toThrow('Caption end must be after start.');
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
});

describe('remote media URL guard', () => {
  it.each(['http://example.com/video.mp4', 'https://localhost/video.mp4', 'https://127.0.0.1/video.mp4', 'https://192.168.1.2/video.mp4'])('blocks unsafe URL %s', (url) => {
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
    project.workflow.captions = [{id: 'cue', text: 'caption', startSeconds: 1, endSeconds: 3, preset: 'clean', emphasis: [], safeArea: true}];
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
  it('rejects excessive render duration, fps, and resolution', () => {
    const project = {...structuredClone(initialState), id: 'limits', projectName: 'Limits', duration: 1};
    expect(() => assertRenderLimits(project)).not.toThrow();
    expect(() => assertRenderLimits({...project, duration: 3601})).toThrow('duration');
    expect(() => assertRenderLimits({...project, fps: 120})).toThrow('fps');
    expect(() => assertRenderLimits({...project, resolution: {width: 7680, height: 4320}})).toThrow('resolution');
  });
  it('normalizes only same-origin signed render download routes', () => {
    expect(normalizeRenderDownloadUrl('/api/render/file/render-id?expires=1&token=signed', 'https://clip.example')).toBe('/api/render/file/render-id?expires=1&token=signed');
    expect(() => normalizeRenderDownloadUrl('https://evil.example/file.mp4', 'https://clip.example')).toThrow('invalid');
    expect(() => normalizeRenderDownloadUrl('/projects', 'https://clip.example')).toThrow('invalid');
    expect(() => normalizeRenderDownloadUrl('/api/render/file/render-id/extra', 'https://clip.example')).toThrow('invalid');
  });
  it('signs render downloads and rejects tampered tokens', () => {
    const previous = process.env.CLIPJS_AGENT_TOKEN;
    process.env.CLIPJS_AGENT_TOKEN = 'unit-test-secret';
    try {
      const token = createRenderDownloadToken('render-id', 60);
      expect(() => verifyRenderDownloadToken('render-id', token)).not.toThrow();
      expect(() => verifyRenderDownloadToken('other-id', token)).toThrow('invalid');
    } finally {
      if (previous === undefined) delete process.env.CLIPJS_AGENT_TOKEN;
      else process.env.CLIPJS_AGENT_TOKEN = previous;
    }
  });
});

describe('project reducer workflow invariants', () => {
  it('keeps caption duration when media changes and invalidates changed storyboard approval', () => {
    const base = structuredClone(initialState);
    base.workflow = {
      ...createDefaultWorkflow(), storyboard,
      approval: {status: 'approved', storyboardHash: 'signed-hash'},
      captions: [{id: 'caption', text: '끝', startSeconds: 4, endSeconds: 5, preset: 'clean', emphasis: [], safeArea: true}],
    };
    const afterMedia = projectReducer(base, setMediaFiles([]));
    expect(afterMedia.duration).toBe(5);
    const changedStoryboard = {...storyboard, title: 'Changed'};
    const afterStoryboard = projectReducer(afterMedia, setWorkflow({...afterMedia.workflow, storyboard: changedStoryboard, approval: {status: 'approved', storyboardHash: 'forged'}}));
    expect(afterStoryboard.workflow.approval.status).toBe('invalidated');
  });
});
