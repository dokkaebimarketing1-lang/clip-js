import {describe, expect, it} from 'vitest';
import {initialState} from '@/app/store/slices/projectSlice';
import {
  ProjectImportError,
  parseProjectDocumentJson,
  serializeProject,
} from './project-file';

const portableProject = () => {
  const project = structuredClone(initialState);
  project.id = 'portable-project';
  project.projectName = 'Portable project';
  project.mediaFiles = [{
    id: 'generated-media',
    fileName: 'generated.mp4',
    type: 'video',
    startTime: 0,
    endTime: 2,
    positionStart: 0,
    positionEnd: 2,
    includeInMerge: true,
    playbackSpeed: 1,
    volume: 100,
    zIndex: 1,
    opacity: 100,
    provider: 'byteplus',
    source: {kind: 'generated', generatedAssetId: 'generated-asset-1'},
    generatedAssetId: 'generated-asset-1',
    remoteUrl: '/api/projects/portable-project/assets/generated-asset-1?token=secret',
    src: '/api/projects/portable-project/assets/generated-asset-1?token=secret',
  }];
  return project;
};

describe('portable project documents', () => {
  it('roundtrips a valid project while preserving durable media identity', () => {
    const serialized = serializeProject(portableProject());

    const restored = parseProjectDocumentJson(JSON.stringify(serialized));

    expect(restored.id).toBe('portable-project');
    expect(restored.mediaFiles[0].source).toEqual({kind: 'generated', generatedAssetId: 'generated-asset-1'});
    expect(restored.mediaFiles[0].src).toBeUndefined();
    expect(JSON.stringify(serialized)).not.toContain('token=secret');
  });

  it('rejects invalid JSON before project validation', () => {
    expect(() => parseProjectDocumentJson('{not-json')).toThrowError(ProjectImportError);

    try {
      parseProjectDocumentJson('{not-json');
    } catch (error) {
      expect(error).toMatchObject({code: 'invalid-json'});
    }
  });

  it('rejects a document with an unsupported schema version', () => {
    const document = {...serializeProject(portableProject()), schemaVersion: 999};

    try {
      parseProjectDocumentJson(JSON.stringify(document));
      throw new Error('Expected project import to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectImportError);
      expect(error).toMatchObject({code: 'invalid-project-file'});
    }
  });

  it('migrates a legacy document through the current project ingress', () => {
    const current = structuredClone(initialState);
    const {projectSchemaVersion: _projectSchemaVersion, revision: _revision, ...legacyProject} = current;
    legacyProject.id = 'legacy-project';
    legacyProject.projectName = 'Legacy project';
    legacyProject.mediaFiles = [{
      id: 'legacy-media',
      fileId: 'legacy-file',
      fileName: 'legacy.mp4',
      type: 'video',
      startTime: 0,
      endTime: 2,
      positionStart: 0,
      positionEnd: 2,
      includeInMerge: true,
      playbackSpeed: 1,
      volume: 100,
      zIndex: 1,
      opacity: 100,
    }];
    const document = {
      kind: 'clipjs-storyboard-project',
      schemaVersion: 1,
      exportedAt: '2026-08-15T00:00:00.000Z',
      project: legacyProject,
    };

    const restored = parseProjectDocumentJson(JSON.stringify(document));

    expect(restored.projectSchemaVersion).toBe(3);
    expect(restored.revision).toBe(0);
    expect(restored.mediaFiles[0].source).toEqual({kind: 'indexeddb', fileId: 'legacy-file'});
  });
});
