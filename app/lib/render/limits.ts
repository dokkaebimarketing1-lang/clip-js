import type {ProjectState} from '@/app/types';

export const assertRenderLimits = (project: ProjectState): void => {
  const {width, height} = project.resolution;
  if (!Number.isFinite(project.duration) || project.duration <= 0 || project.duration > 180) {
    throw new Error('Render duration must be between 0 and 180 seconds for synchronous rendering.');
  }
  if (!Number.isFinite(project.fps) || project.fps <= 0 || project.fps > 60) {
    throw new Error('Render fps must be between 1 and 60.');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 1920 || height > 1080 || width * height > 2_073_600) {
    throw new Error('Render resolution must be positive and no larger than 1920x1080 for synchronous rendering.');
  }
  const captionWordCount = project.workflow.captions.reduce((total, cue) => total + cue.wordTimings.length, 0);
  const production = project.workflow.production;
  const productionItemCount = production.assets.length + production.continuityLocks.length + production.shotSpecs.length + production.takes.length;
  if (project.mediaFiles.length > 500 || project.textElements.length > 1000 || project.workflow.captions.length > 5000 || captionWordCount > 100_000 || project.workflow.transitions.length > 500 || project.workflow.effects.length > 1000 || productionItemCount > 13_000) {
    throw new Error('Render project exceeds the supported item count.');
  }
  const captionsByLane = new Map<string, typeof project.workflow.captions>();
  for (const cue of project.workflow.captions) {
    captionsByLane.set(cue.position, [...(captionsByLane.get(cue.position) ?? []), cue]);
  }
  captionsByLane.forEach((cues, lane) => {
    const ordered = [...cues].sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds);
    let active = ordered[0];
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index].startSeconds < active.endSeconds) {
        throw new Error(`Captions overlap in the ${lane} caption lane (${active.id}, ${ordered[index].id}).`);
      }
      active = ordered[index];
    }
  });
};
