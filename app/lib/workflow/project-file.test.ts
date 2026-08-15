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
    transform: {x: 0.125, y: -0.25, rotation: 15, scale: 1.2},
    crop: {left: 0.1, top: 0.2, width: 0.7, height: 0.6},
    provider: 'byteplus',
    source: {kind: 'generated', generatedAssetId: 'generated-asset-1'},
    generatedAssetId: 'generated-asset-1',
    remoteUrl: '/api/projects/portable-project/assets/generated-asset-1?token=secret',
    src: '/api/projects/portable-project/assets/generated-asset-1?token=secret',
  }];
  project.textElements = [{
    id: 'title',
    text: 'Title',
    positionStart: 0,
    positionEnd: 2,
    x: 120,
    y: 80,
    transform: {x: -0.05, y: 0.1, rotation: -8, scale: 0.9},
  }];
  project.shapes = [{
    id: 'title-accent',
    type: 'line',
    positionStart: 0,
    positionEnd: 2,
    x: 120,
    y: 320,
    width: 400,
    height: 6,
    color: '#d946ef',
    opacity: 90,
    zIndex: 2,
    transform: {x: 0.05, y: 0, rotation: 4, scale: 1},
  }];
  return project;
};

describe('portable project documents', () => {
  it('roundtrips a valid project while preserving durable media identity', () => {
    const serialized = serializeProject(portableProject());

    const restored = parseProjectDocumentJson(JSON.stringify(serialized));

    expect(restored.id).toBe('portable-project');
    expect(restored.mediaFiles[0].source).toEqual({kind: 'generated', generatedAssetId: 'generated-asset-1'});
    expect(restored.mediaFiles[0].transform).toEqual({x: 0.125, y: -0.25, rotation: 15, scale: 1.2});
    expect(restored.mediaFiles[0].crop).toEqual({left: 0.1, top: 0.2, width: 0.7, height: 0.6});
    expect(restored.textElements[0].transform).toEqual({x: -0.05, y: 0.1, rotation: -8, scale: 0.9});
    expect(restored.shapes[0].transform).toEqual({x: 0.05, y: 0, rotation: 4, scale: 1});
    expect(restored.mediaFiles[0].src).toBeUndefined();
    expect(JSON.stringify(serialized)).not.toContain('token=secret');
  });

  it('rejects crop rectangles outside normalized media bounds', () => {
    const serialized = serializeProject(portableProject());
    const invalid = {
      ...serialized,
      project: {
        ...serialized.project,
        mediaFiles: serialized.project.mediaFiles.map((media) => ({
          ...media,
          crop: {left: 0.7, top: 0.2, width: 0.5, height: 0.6},
        })),
      },
    };

    expect(() => parseProjectDocumentJson(JSON.stringify(invalid))).toThrowError(ProjectImportError);
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
    expect(restored.shapes).toEqual([]);
    expect(restored.mediaFiles[0].source).toEqual({kind: 'indexeddb', fileId: 'legacy-file'});
  });
});
