import type {MediaFile, ProjectState} from '@/app/types';
import {invalidateForCreativeChange, invalidateForReleaseChange} from './approval';
import {productionManifestSchema} from './production-schema';
import {storyboardSchema} from './schema';

type CutFrameRole = 'start' | 'end' | 'preview';

type AttachCutFrameInput = {
  cutId: string;
  role: CutFrameRole;
  assetId: string;
  contentSha256: string;
  fileName: string;
};

const frameField: Record<CutFrameRole, 'startFrameAssetId' | 'endFrameAssetId' | 'previewAssetId'> = {
  start: 'startFrameAssetId',
  end: 'endFrameAssetId',
  preview: 'previewAssetId',
};

export const attachCutFrameAsset = (project: ProjectState, input: AttachCutFrameInput): ProjectState => {
  const next = structuredClone(project);
  if (!next.workflow.storyboard) throw new Error('Storyboard is required before attaching cut frames.');
  const cut = next.workflow.storyboard.cuts.find((item) => item.id === input.cutId);
  if (!cut) throw new Error('Cut does not exist.');
  cut[frameField[input.role]] = input.assetId;
  const duration = cut.absoluteEndSeconds - cut.absoluteStartSeconds;
  const role = input.role === 'preview' ? 'storyboard-sheet' : input.role;
  next.mediaFiles = next.mediaFiles.filter((media) => !(media.cutId === input.cutId && media.storyboardRole === role));
  const media: MediaFile = {
    id: `frame-${input.cutId}-${input.role}-${input.assetId}`,
    fileName: input.fileName,
    type: 'image',
    source: {kind: 'managed', assetId: input.assetId},
    contentSha256: input.contentSha256,
    cutId: input.cutId,
    shotId: cut.shots[0]?.id,
    storyboardRole: role,
    startTime: 0,
    endTime: duration,
    positionStart: cut.absoluteStartSeconds,
    positionEnd: cut.absoluteEndSeconds,
    includeInMerge: false,
    playbackSpeed: 1,
    volume: 0,
    zIndex: 1,
    opacity: 100,
  };
  next.mediaFiles.unshift(media);
  next.workflow.storyboard = storyboardSchema.parse(next.workflow.storyboard);
  next.workflow = invalidateForCreativeChange(next.workflow);
  return next;
};

export const reorderStoryboardCuts = (project: ProjectState, orderedCutIds: string[]): ProjectState => {
  const next = structuredClone(project);
  const storyboard = next.workflow.storyboard;
  if (!storyboard) throw new Error('Storyboard is required before reordering cuts.');
  const currentIds = storyboard.cuts.map((cut) => cut.id);
  if (orderedCutIds.length !== currentIds.length || new Set(orderedCutIds).size !== currentIds.length || currentIds.some((id) => !orderedCutIds.includes(id))) {
    throw new Error('Cut order must include every storyboard cut exactly once.');
  }
  const byId = new Map(storyboard.cuts.map((cut) => [cut.id, cut]));
  let cursor = 0;
  storyboard.cuts = orderedCutIds.map((id) => {
    const cut = byId.get(id)!;
    const duration = cut.absoluteEndSeconds - cut.absoluteStartSeconds;
    const shifted = {...cut, absoluteStartSeconds: cursor, absoluteEndSeconds: cursor + duration};
    cursor += duration;
    return shifted;
  });
  next.mediaFiles = next.mediaFiles.map((media) => {
    const cut = storyboard.cuts.find((item) => item.id === media.cutId);
    if (!cut || !media.storyboardRole) return media;
    const duration = media.positionEnd - media.positionStart;
    return {...media, positionStart: cut.absoluteStartSeconds, positionEnd: cut.absoluteStartSeconds + duration};
  });
  next.workflow.storyboard = storyboardSchema.parse(storyboard);
  next.workflow = invalidateForCreativeChange(next.workflow);
  return next;
};

const extractEditValue = (instruction: string, label: '제목' | '행동'): string | undefined => {
  const pattern = label === '제목'
    ? /제목을\s+(.+?)(?:로|으로)\s*바꾸(?:고|어|기|줘)/
    : /행동을\s+(.+?)(?:로|으로)\s*바꿔?(?:고|줘|주세요|기|$)/;
  return pattern.exec(instruction)?.[1]?.trim();
};

export const updateCutFromInstruction = (project: ProjectState, cutId: string, instruction: string): ProjectState => {
  const normalized = instruction.trim();
  if (!normalized || normalized.length > 1000) throw new Error('Cut edit instruction must be 1–1000 characters.');
  const next = structuredClone(project);
  const cut = next.workflow.storyboard?.cuts.find((item) => item.id === cutId);
  if (!cut) throw new Error('Cut does not exist.');
  const title = extractEditValue(normalized, '제목');
  const action = extractEditValue(normalized, '행동');
  if (!title && !action) throw new Error('지원되는 지시는 “제목을 …로 바꿔줘” 또는 “행동을 …로 바꿔줘”입니다.');
  if (title) cut.title = title;
  if (action) cut.shots[0].action = action;
  next.workflow.storyboard = storyboardSchema.parse(next.workflow.storyboard);
  next.workflow = invalidateForCreativeChange(next.workflow);
  return next;
};

export const selectTakeForTimeline = (project: ProjectState, takeId: string): ProjectState => {
  const next = structuredClone(project);
  const take = next.workflow.production.takes.find((item) => item.id === takeId);
  if (!take) throw new Error('Generation take not found.');
  if (take.verdict !== 'accepted') throw new Error('Only accepted takes can be placed on the timeline.');
  const scope = take.scope === 'production' ? '__production__' : take.shotSpecId;
  next.workflow.production.takes = next.workflow.production.takes.map((item) => {
    const itemScope = item.scope === 'production' ? '__production__' : item.shotSpecId;
    return itemScope === scope ? {...item, selected: item.id === takeId} : item;
  });
  const takeIdsInScope = new Set(next.workflow.production.takes.filter((item) => (item.scope === 'production' ? '__production__' : item.shotSpecId) === scope).map((item) => item.id));
  next.mediaFiles = next.mediaFiles.map((media) => takeIdsInScope.has(media.takeId ?? '') ? {...media, includeInMerge: media.takeId === takeId} : media);
  next.workflow.production = productionManifestSchema.parse(next.workflow.production);
  next.workflow = invalidateForReleaseChange(next.workflow);
  return next;
};
