import {z} from 'zod';
import type {ProjectState} from '@/app/types';
import {initialState} from '@/app/store/slices/projectSlice';
import {workflowStateSchema} from './schema';
import {invalidateApproval} from './approval';

export const PROJECT_FILE_VERSION = 2 as const;

const mediaFileSchema = z.object({
  id: z.string().min(1).max(128),
  fileId: z.string().min(1).max(128),
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
  src: z.string().max(4096).optional(),
  remoteUrl: z.string().url().max(4096).optional(),
}).passthrough().refine((media) => media.endTime > media.startTime && media.positionEnd > media.positionStart, 'Media ranges must have positive duration.');

const textElementSchema = z.object({
  id: z.string().min(1).max(128),
  text: z.string().max(5000),
  positionStart: z.number().finite().nonnegative(),
  positionEnd: z.number().finite().positive(),
}).passthrough().refine((text) => text.positionEnd > text.positionStart, 'Text range must have positive duration.');

export const projectStateSchema = z.object({
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
  workflow: workflowStateSchema,
}).passthrough().superRefine((project, ctx) => {
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
    if (from.type === 'audio' || to.type === 'audio') {
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

const projectDocumentSchema = z.object({
  kind: z.literal('clipjs-storyboard-project'),
  schemaVersion: z.literal(PROJECT_FILE_VERSION),
  exportedAt: z.string().datetime(),
  project: projectStateSchema,
});

export type ProjectDocument = z.infer<typeof projectDocumentSchema>;

export const serializeProject = (project: ProjectState): ProjectDocument => {
  const mediaFiles = project.mediaFiles.map((media) => {
    const serialized = {...media};
    delete serialized.src;
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
  const mediaFiles = project.mediaFiles.map((media) => ({
    ...media,
    src: media.remoteUrl ?? media.src,
    provider: media.provider ?? (media.remoteUrl ? 'higgsfield' : 'local'),
  }));
  const duration = Math.max(
    0,
    ...mediaFiles.map((media) => media.positionEnd),
    ...project.textElements.map((text) => text.positionEnd),
    ...workflow.captions.map((cue) => cue.endSeconds),
  );
  return {
    ...structuredClone(initialState),
    ...project,
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
    workflow: {
      ...imported.workflow,
      approval: invalidateApproval(imported.workflow.approval),
    },
  };
};

export const parseRenderProjectRequest = (input: unknown): ProjectState => {
  const body = z.object({project: z.unknown()}).strict().parse(input);
  return parseProjectState(body.project);
};

export const parseProjectDocument = (input: unknown): ProjectState => {
  const document = projectDocumentSchema.parse(input);
  return parseProjectState(document.project);
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
