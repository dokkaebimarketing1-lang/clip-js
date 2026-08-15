import {z} from 'zod';
import type {ProjectState} from '@/app/types';
import {initialState} from '@/app/store/slices/projectSlice';
import {elementTransformSchema, normalizedCropSchema, shapeElementSchema, workflowStateSchema} from './schema';
import {invalidateForCreativeChange} from './approval';

export const PROJECT_FILE_VERSION = 3 as const;

const mediaSourceSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('indexeddb'), fileId: z.string().min(1).max(128)}).strict(),
  z.object({kind: z.literal('generated'), generatedAssetId: z.string().min(1).max(256)}).strict(),
  z.object({kind: z.literal('managed'), assetId: z.string().min(1).max(256)}).strict(),
  z.object({kind: z.literal('external-unverified'), url: z.string().url().max(4096)}).strict(),
]);

const migrateMediaSource = (input: unknown): unknown => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const media = {...input as Record<string, unknown>};
  if (!media.source) {
    if (typeof media.generatedAssetId === 'string') media.source = {kind: 'generated', generatedAssetId: media.generatedAssetId};
    else if (typeof media.remoteUrl === 'string') media.source = {kind: 'external-unverified', url: media.remoteUrl};
    else if (typeof media.fileId === 'string') media.source = {kind: 'indexeddb', fileId: media.fileId};
  }
  return media;
};

const mediaFileBaseSchema = z.object({
  id: z.string().min(1).max(128),
  fileId: z.string().min(1).max(128).optional(),
  source: mediaSourceSchema,
  fileName: z.string().min(1).max(512),
  type: z.enum(['video', 'audio', 'image', 'unknown']),
  startTime: z.number().finite().nonnegative(),
  endTime: z.number().finite().positive(),
  positionStart: z.number().finite().nonnegative(),
  positionEnd: z.number().finite().positive(),
  includeInMerge: z.boolean(),
  playbackSpeed: z.number().finite().min(0.1).max(4),
  volume: z.number().finite().min(0).max(100),
  zIndex: z.number().finite(),
  opacity: z.number().finite().min(0).max(100),
  transform: elementTransformSchema.optional(),
  crop: normalizedCropSchema.optional(),
  src: z.string().max(4096).optional(),
  remoteUrl: z.string().max(4096).optional(),
  provider: z.enum(['local', 'higgsfield', 'byteplus']).optional(),
  generatedAssetId: z.string().min(1).max(256).optional(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  takeId: z.string().min(1).max(256).optional(),
}).passthrough().superRefine((media, ctx) => {
  if (!(media.endTime > media.startTime && media.positionEnd > media.positionStart)) ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Media ranges must have positive duration.'});
  if (media.source.kind === 'generated' && media.generatedAssetId && media.generatedAssetId !== media.source.generatedAssetId) ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Generated media source identity mismatch.'});
});

const mediaFileSchema = z.preprocess(migrateMediaSource, mediaFileBaseSchema);

const textElementSchema = z.object({
  id: z.string().min(1).max(128),
  text: z.string().max(5000),
  positionStart: z.number().finite().nonnegative(),
  positionEnd: z.number().finite().positive(),
  transform: elementTransformSchema.optional(),
}).passthrough().refine((text) => text.positionEnd > text.positionStart, 'Text range must have positive duration.');

const projectStateV3Schema = z.object({
  projectSchemaVersion: z.literal(3),
  revision: z.number().int().nonnegative(),
  id: z.string().min(1),
  projectName: z.string().min(1),
  duration: z.number().finite().nonnegative().optional(),
  currentTime: z.number().finite().nonnegative().optional(),
  isPlaying: z.boolean().optional(),
  isMuted: z.boolean().optional(),
  fps: z.number().finite().positive().max(60).optional(),
  resolution: z.object({width: z.number().int().positive(), height: z.number().int().positive()}).optional(),
  mediaFiles: z.array(mediaFileSchema).max(500),
  textElements: z.array(textElementSchema).max(1000),
  shapes: z.array(shapeElementSchema).max(1000).default([]),
  workflow: workflowStateSchema,
}).passthrough().superRefine((project, ctx) => {
  const mediaIds = new Set<string>();
  project.mediaFiles.forEach((media, index) => {
    if (mediaIds.has(media.id)) {
      ctx.addIssue({code: z.ZodIssueCode.custom, path: ['mediaFiles', index, 'id'], message: `Duplicate media ID: ${media.id}.`});
    }
    mediaIds.add(media.id);
  });
  const mediaById = new Map(project.mediaFiles.map((media) => [media.id, media]));
  project.workflow.effects.forEach((effect, index) => {
    const media = mediaById.get(effect.targetMediaId);
    if (!media || !['video', 'image'].includes(media.type)) {
      ctx.addIssue({code: z.ZodIssueCode.custom, path: ['workflow', 'effects', index, 'targetMediaId'], message: 'Effect target must be visual media.'});
      return;
    }
    if (effect.startSeconds < media.positionStart || effect.endSeconds > media.positionEnd) {
      ctx.addIssue({code: z.ZodIssueCode.custom, path: ['workflow', 'effects', index], message: 'Effect range must stay within the target media timeline range.'});
    }
  });
  const transitionIds = new Set<string>();
  project.workflow.transitions.forEach((transition, index) => {
    const path: Array<string | number> = ['workflow', 'transitions', index];
    if (transitionIds.has(transition.id)) {
      ctx.addIssue({code: z.ZodIssueCode.custom, path: [...path, 'id'], message: `Duplicate transition ID: ${transition.id}.`});
    }
    transitionIds.add(transition.id);
    if (transition.fromMediaId === transition.toMediaId) {
      ctx.addIssue({code: z.ZodIssueCode.custom, path, message: `Transition ${transition.id} must connect distinct media.`});
      return;
    }
    const from = mediaById.get(transition.fromMediaId);
    const to = mediaById.get(transition.toMediaId);
    if (!from || !to) {
      ctx.addIssue({code: z.ZodIssueCode.custom, path, message: `Transition ${transition.id} references missing media.`});
      return;
    }
    if (!['video', 'image'].includes(from.type) || !['video', 'image'].includes(to.type)) {
      ctx.addIssue({code: z.ZodIssueCode.custom, path, message: `Transition ${transition.id} requires visual media endpoints.`});
    }
    if (from.positionStart > to.positionStart) {
      ctx.addIssue({code: z.ZodIssueCode.custom, path, message: `Transition ${transition.id} endpoints are in reversed timeline order.`});
    }
    const endpointDuration = Math.min(from.positionEnd - from.positionStart, to.positionEnd - to.positionStart);
    if (transition.durationSeconds > endpointDuration) {
      ctx.addIssue({code: z.ZodIssueCode.custom, path, message: `Transition ${transition.id} exceeds an endpoint media range.`});
    }
  });
});

const migrateProjectStateInput = (input: unknown): unknown => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const project = {...input as Record<string, unknown>};
  project.projectSchemaVersion = 3;
  project.revision = Number.isSafeInteger(project.revision) && Number(project.revision) >= 0 ? project.revision : 0;
  return project;
};

export const projectStateSchema = z.preprocess(migrateProjectStateInput, projectStateV3Schema);

const projectDocumentSchema = z.object({
  kind: z.literal('clipjs-storyboard-project'),
  schemaVersion: z.literal(PROJECT_FILE_VERSION),
  exportedAt: z.string().datetime(),
  project: projectStateSchema,
});

const projectDocumentIngressSchema = z.object({
  kind: z.literal('clipjs-storyboard-project'),
  schemaVersion: z.number().int().min(1).max(PROJECT_FILE_VERSION),
  exportedAt: z.string().datetime(),
  project: z.unknown(),
});

export type ProjectDocument = z.infer<typeof projectDocumentSchema>;

export type ProjectImportErrorCode = 'invalid-json' | 'invalid-project-file';

export class ProjectImportError extends Error {
  readonly code: ProjectImportErrorCode;

  constructor(code: ProjectImportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProjectImportError';
    this.code = code;
  }
}

export const serializeProject = (project: ProjectState): ProjectDocument => {
  const mediaFiles = project.mediaFiles.map((media) => {
    const serialized = {...media};
    delete serialized.src;
    delete serialized.remoteUrl;
    return serialized;
  });
  return projectDocumentSchema.parse({
    kind: 'clipjs-storyboard-project',
    schemaVersion: PROJECT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    project: {
      ...project,
      mediaFiles,
      history: [],
      future: [],
      currentTime: 0,
      isPlaying: false,
    },
  });
};

export const parseProjectState = (input: unknown): ProjectState => {
  const project = projectStateSchema.parse(input) as unknown as ProjectState;
  const workflow = workflowStateSchema.parse(project.workflow);
  const mediaFiles = project.mediaFiles.map((media) => {
    const source = media.source
      ?? (media.generatedAssetId
        ? {kind: 'generated' as const, generatedAssetId: media.generatedAssetId}
        : media.remoteUrl
          ? {kind: 'external-unverified' as const, url: media.remoteUrl}
          : {kind: 'indexeddb' as const, fileId: media.fileId!});
    return {
      ...media,
      source,
      generatedAssetId: source.kind === 'generated' ? source.generatedAssetId : media.generatedAssetId,
      remoteUrl: source.kind === 'external-unverified' ? source.url : undefined,
      src: source.kind === 'external-unverified' ? source.url : undefined,
      provider: media.provider ?? (source.kind === 'generated' ? 'byteplus' : source.kind === 'external-unverified' ? 'higgsfield' : 'local'),
    };
  });
  const duration = Math.max(
    0,
    ...mediaFiles.map((media) => media.positionEnd),
    ...project.textElements.map((text) => text.positionEnd),
    ...project.shapes.map((shape) => shape.positionEnd),
    ...workflow.captions.map((cue) => cue.endSeconds),
  );
  return {
    ...structuredClone(initialState),
    ...project,
    projectSchemaVersion: 3,
    revision: project.revision ?? 0,
    workflow,
    mediaFiles,
    duration,
    history: [],
    future: [],
    currentTime: project.currentTime ?? 0,
    isPlaying: project.isPlaying ?? false,
  };
};

export const importProjectIntoCurrentProject = (input: unknown, currentProjectId: string): ProjectState => {
  const imported = parseProjectState(input);
  if (imported.id === currentProjectId) return imported;
  return {
    ...imported,
    id: currentProjectId,
    revision: 0,
    workflow: invalidateForCreativeChange(imported.workflow),
  };
};

export const parseRenderProjectRequest = (input: unknown): ProjectState => {
  const body = z.object({project: z.unknown()}).strict().parse(input);
  return parseProjectState(body.project);
};

export const parseProjectDocument = (input: unknown): ProjectState => {
  const document = projectDocumentIngressSchema.parse(input);
  return parseProjectState(document.project);
};

export const parseProjectDocumentJson = (input: string): ProjectState => {
  let document: unknown;
  try {
    document = JSON.parse(input);
  } catch (error) {
    if (error instanceof SyntaxError) throw new ProjectImportError('invalid-json', 'Project file is not valid JSON.', {cause: error});
    throw error;
  }
  try {
    return parseProjectDocument(document);
  } catch (error) {
    if (error instanceof z.ZodError) throw new ProjectImportError('invalid-project-file', 'Project file is invalid or unsupported.', {cause: error});
    throw error;
  }
};

export const downloadProjectDocument = (project: ProjectState): void => {
  const blob = new Blob([JSON.stringify(serializeProject(project), null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${project.projectName.replace(/[^a-zA-Z0-9가-힣_-]+/g, '-') || 'clipjs-project'}.clipjs.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};
