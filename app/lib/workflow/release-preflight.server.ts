import type {ProjectState} from '@/app/types';
import {verifyTakeApprovalSignature} from '@/app/lib/security/approval-signature';

const close = (left: number, right: number): boolean => Math.abs(left - right) <= 0.05;
const assertWithinProject = (start: number, end: number, duration: number, label: string): void => {
  if (start < 0 || end <= start || end > duration + 0.05) throw new Error(`${label} is outside the render duration.`);
};

export const assertReleasePreflight = (project: ProjectState): void => {
  const unmanaged = project.mediaFiles.find((media) => media.source?.kind === 'external-unverified');
  if (unmanaged) throw new Error(`External media ${unmanaged.id} is unverified and must be securely ingested before release.`);
  const generatedMedia = project.mediaFiles.filter((media) => media.source?.kind === 'generated' || media.provider === 'byteplus');
  for (const media of generatedMedia) {
    if (!media.takeId || !media.generatedAssetId || !media.contentSha256) throw new Error(`Generated media ${media.id} has incomplete Take provenance.`);
    const take = project.workflow.production.takes.find((candidate) => candidate.id === media.takeId);
    if (!take || take.qcStatus !== 'approved' || !take.selected || take.takeApproval.status !== 'approved') {
      throw new Error(`Generated media ${media.id} requires an approved selected Take.`);
    }
    if (take.outputAssetId !== media.generatedAssetId || take.contentSha256 !== media.contentSha256
      || take.takeApproval.assetId !== media.generatedAssetId || take.takeApproval.contentSha256 !== media.contentSha256) {
      throw new Error(`Generated media ${media.id} does not match its Take approval identity.`);
    }
    verifyTakeApprovalSignature(project.id, take.takeApproval);
  }

  const post = project.workflow.postProduction;
  if (post.dialogueCues.length > 0 && !project.exportSettings.includeSubtitles) throw new Error('Release preflight requires subtitle export for approved dialogue captions.');
  for (const lane of [...post.ambience, ...post.sfx, ...post.bgm]) {
    assertWithinProject(lane.startSeconds, lane.endSeconds, project.duration, `Audio lane ${lane.id}`);
    const media = project.mediaFiles.find((candidate) => candidate.id === lane.mediaId);
    if (!media || !['audio', 'video'].includes(media.type) || media.source?.kind !== 'managed' || !media.contentSha256) {
      throw new Error(`Audio lane ${lane.id} references missing media.`);
    }
    if (media.includeInMerge === false) throw new Error(`Audio lane ${lane.id} is excluded from render.`);
    if (media.positionStart > lane.startSeconds || media.positionEnd < lane.endSeconds) {
      throw new Error(`Audio lane ${lane.id} is not present for its approved time range.`);
    }
    if (Math.abs((media.volume ?? 100) - lane.volume) > 1) {
      throw new Error(`Audio lane ${lane.id} volume does not match the rendered media volume.`);
    }
  }
  if (project.workflow.storyboard?.noBgm && post.bgm.length) throw new Error('The approved storyboard forbids BGM.');
  if (!generatedMedia.length) return;

  const checklist = post.releaseChecklist;
  if (!Object.values(checklist).every(Boolean)) throw new Error('Every post-production release checklist item must be verified.');
  if (!post.dialogueCues.length) throw new Error('Generated marketing video requires reviewed Korean dialogue.');
  if (!post.ambience.length && !post.sfx.length) throw new Error('Generated marketing video requires an ambience or SFX lane.');
  if (!post.appUiOverlays.length) throw new Error('Generated marketing video requires a verified app UI overlay.');
  if (!post.endingCard) throw new Error('Generated marketing video requires a verified ending card and CTA.');
  if (post.sourceAudioPolicy === 'keep') throw new Error('Generated source audio must be muted or ducked under exact Korean dialogue.');
  for (const media of generatedMedia) {
    if (post.sourceAudioPolicy === 'mute' && (media.volume ?? 100) !== 0) {
      throw new Error(`Generated source media ${media.id} must have rendered volume 0 for mute policy.`);
    }
    if (post.sourceAudioPolicy === 'duck' && (media.volume ?? 100) > 30) {
      throw new Error(`Generated source media ${media.id} must have rendered volume at most 30 for duck policy.`);
    }
  }

  const declaredAudioIds = new Set([
    ...post.dialogueCues.map((cue) => cue.mediaId),
    ...post.ambience.map((lane) => lane.mediaId),
    ...post.sfx.map((lane) => lane.mediaId),
    ...post.bgm.map((lane) => lane.mediaId),
  ]);
  const undeclaredAudio = project.mediaFiles.find((media) => media.type === 'audio' && !declaredAudioIds.has(media.id));
  if (undeclaredAudio) throw new Error(`Audio media ${undeclaredAudio.id} is not assigned to an approved post-production lane.`);

  for (const cue of post.dialogueCues) {
    assertWithinProject(cue.startSeconds, cue.endSeconds, project.duration, `Dialogue cue ${cue.id}`);
    if (!/[가-힣]/.test(cue.text)) throw new Error(`Dialogue cue ${cue.id} must contain reviewed Korean text.`);
    const dialogueMedia = project.mediaFiles.find((media) => media.id === cue.mediaId && media.type === 'audio');
    if (!dialogueMedia || dialogueMedia.source?.kind !== 'managed' || !dialogueMedia.contentSha256) {
      throw new Error(`Dialogue cue ${cue.id} requires a separate audio media lane.`);
    }
    if (dialogueMedia.includeInMerge === false) throw new Error(`Dialogue cue ${cue.id} audio is excluded from render.`);
    if (dialogueMedia.positionStart > cue.startSeconds || dialogueMedia.positionEnd < cue.endSeconds || (dialogueMedia.volume ?? 100) <= 0) {
      throw new Error(`Dialogue cue ${cue.id} is not audibly rendered for its approved range.`);
    }
    const caption = project.workflow.captions.find((candidate) => candidate.text === cue.text
      && close(candidate.startSeconds, cue.startSeconds) && close(candidate.endSeconds, cue.endSeconds));
    if (!caption) throw new Error(`Dialogue cue ${cue.id} requires an exact matching Korean caption.`);
  }

  for (const overlay of post.appUiOverlays) {
    assertWithinProject(overlay.startSeconds, overlay.endSeconds, project.duration, `App UI overlay ${overlay.id}`);
    const media = project.mediaFiles.find((candidate) => candidate.id === overlay.mediaId);
    if (!media || !['image', 'video'].includes(media.type) || media.source?.kind !== 'managed' || !media.contentSha256
      || media.positionStart > overlay.startSeconds || media.positionEnd < overlay.endSeconds) {
      throw new Error(`App UI overlay ${overlay.id} is not backed by visible media for its full range.`);
    }
    if (media.includeInMerge === false || (media.opacity ?? 100) <= 0) throw new Error(`App UI overlay ${overlay.id} is invisible or excluded.`);
    if ((media.x ?? 0) < 0 || (media.y ?? 0) < 0 || (media.x ?? 0) >= project.resolution.width || (media.y ?? 0) >= project.resolution.height) {
      throw new Error(`App UI overlay ${overlay.id} is outside the render frame.`);
    }
    const highestSourceLayer = Math.max(...generatedMedia.map((source) => source.zIndex), -1);
    if (media.zIndex <= highestSourceLayer) throw new Error(`App UI overlay ${overlay.id} is behind generated source footage.`);
  }

  const card = post.endingCard;
  assertWithinProject(card.startSeconds, card.endSeconds, project.duration, 'Ending card');
  const brand = project.textElements.find((element) => element.id === card.brandTextElementId);
  const cta = project.textElements.find((element) => element.id === card.ctaTextElementId);
  if (!brand || brand.text !== card.brandName || !cta || cta.text !== card.cta) {
    throw new Error('Ending card brand and CTA must match actual rendered TextElements.');
  }
  if (brand.positionStart > card.startSeconds || brand.positionEnd < card.endSeconds
    || cta.positionStart > card.startSeconds || cta.positionEnd < card.endSeconds) {
    throw new Error('Ending card text is not visible for the approved ending range.');
  }
  if (brand.includeInMerge === false || cta.includeInMerge === false || (brand.opacity ?? 100) <= 0 || (cta.opacity ?? 100) <= 0) {
    throw new Error('Ending-card text is invisible or excluded.');
  }
  const highestSourceLayer = Math.max(...generatedMedia.map((source) => source.zIndex), -1);
  for (const item of [brand, cta]) {
    if (item.x < 0 || item.y < 0 || item.x >= project.resolution.width || item.y >= project.resolution.height) throw new Error('Ending-card text is outside the render frame.');
    if ((item.zIndex ?? 0) <= highestSourceLayer) throw new Error('Ending-card text is behind generated source footage.');
  }
};
