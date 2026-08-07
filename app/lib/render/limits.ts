import type {ProjectState} from '@/app/types';

export const assertRenderLimits = (project: ProjectState): void => {
  const {width, height} = project.resolution;
  if (!Number.isFinite(project.duration) || project.duration <= 0 || project.duration > 3600) {
    throw new Error('Render duration must be between 0 and 3600 seconds.');
  }
  if (!Number.isFinite(project.fps) || project.fps <= 0 || project.fps > 60) {
    throw new Error('Render fps must be between 1 and 60.');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 3840 || height > 2160 || width * height > 8_294_400) {
    throw new Error('Render resolution must be positive and no larger than 3840x2160.');
  }
  const captionWordCount = project.workflow.captions.reduce((total, cue) => total + cue.wordTimings.length, 0);
  const production = project.workflow.production;
  const productionItemCount = production.assets.length + production.continuityLocks.length + production.shotSpecs.length + production.takes.length;
  if (project.mediaFiles.length > 500 || project.textElements.length > 1000 || project.workflow.captions.length > 5000 || captionWordCount > 100_000 || project.workflow.transitions.length > 500 || project.workflow.effects.length > 1000 || productionItemCount > 13_000) {
    throw new Error('Render project exceeds the supported item count.');
  }
};
