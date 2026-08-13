import {productionManifestSchema, type ProductionManifest, type SceneContinuityLock, type ShotGenerationSpec, type Storyboard} from './schema';

const placeholderLockFor = (cutId: string): SceneContinuityLock => ({
  id: `continuity-lock-${cutId}`,
  sceneId: cutId,
  status: 'draft',
  landmarks: [],
  cameraSide: '—',
  axisRule: '—',
  lightSource: '—',
  shadowDirection: '—',
  palette: {dominant: '#000000', secondary: '#000000', accent: '#000000'},
});

const deriveSpecFor = (cutId: string, shot: {id: string; startSeconds: number; endSeconds: number; startFrame: string; endFrame: string; camera: string; action: string; dialogue: string; sfx: string}, continuityLockId: string): ShotGenerationSpec => ({
  id: `shot-spec-${cutId}-${shot.id}`,
  cutId,
  shotId: shot.id,
  durationSeconds: shot.endSeconds - shot.startSeconds,
  characterCount: 1,
  format: 'single-take',
  activeReferences: [],
  continuityLockId,
  firstFrameBlocking: [],
  optics: '35mm',
  camera: [shot.camera],
  actionBeats: [{startSeconds: 0, endSeconds: shot.endSeconds - shot.startSeconds, action: shot.action}],
  physics: [],
  lighting: {source: '—', direction: '—', preserveContinuity: false},
  audio: {dialogue: shot.dialogue, ambience: '—', sfx: shot.sfx},
  acting: [],
  positiveConstraints: [`match approved storyboard frame: ${shot.startFrame} → ${shot.endFrame}`],
  endState: `match the approved storyboard end frame exactly: ${shot.endFrame}`,
});

export const deriveProductionFromStoryboard = (
  storyboard: Storyboard,
  existing: ProductionManifest = {assets: [], continuityLocks: [], shotSpecs: [], takes: []},
): ProductionManifest => {
  const activeCutIds = new Set(storyboard.cuts.map((cut) => cut.id));
  const continuityLocks = existing.continuityLocks.filter((lock) => activeCutIds.has(lock.sceneId));
  const shotSpecs: ShotGenerationSpec[] = [];
  storyboard.cuts.forEach((cut) => {
    const lockForCut = continuityLocks.find((lock) => lock.sceneId === cut.id);
    const lockId = lockForCut?.id ?? `continuity-lock-${cut.id}`;
    if (!lockForCut) continuityLocks.push(placeholderLockFor(cut.id));
    cut.shots.forEach((shot) => {
      const derived = deriveSpecFor(cut.id, shot, lockId);
      const previous = existing.shotSpecs.find((spec) => spec.cutId === cut.id && spec.shotId === shot.id);
      if (!previous) {
        shotSpecs.push(derived);
        return;
      }
      shotSpecs.push({
        ...previous,
        id: previous.id,
        cutId: derived.cutId,
        shotId: derived.shotId,
        durationSeconds: derived.durationSeconds,
        continuityLockId: derived.continuityLockId,
        camera: derived.camera,
        actionBeats: derived.actionBeats,
        audio: {...previous.audio, dialogue: derived.audio.dialogue, sfx: derived.audio.sfx},
        positiveConstraints: [
          ...previous.positiveConstraints.filter((constraint) => !constraint.startsWith('match approved storyboard frame:')),
          ...derived.positiveConstraints,
        ].filter((constraint, index, constraints) => constraints.indexOf(constraint) === index),
        endState: derived.endState,
      });
    });
  });
  const activeShotSpecIds = new Set(shotSpecs.map((spec) => spec.id));
  const childrenByParentId = new Map<string, string[]>();
  const removedTakeIds = new Set<string>();
  const removalQueue: string[] = [];
  existing.takes.forEach((take) => {
    if (take.parentTakeId) {
      const children = childrenByParentId.get(take.parentTakeId) ?? [];
      children.push(take.id);
      childrenByParentId.set(take.parentTakeId, children);
    }
    if (take.scope === 'shot' && (!take.shotSpecId || !activeShotSpecIds.has(take.shotSpecId))) {
      removedTakeIds.add(take.id);
      removalQueue.push(take.id);
    }
  });
  for (let queueIndex = 0; queueIndex < removalQueue.length; queueIndex += 1) {
    const removedTakeId = removalQueue[queueIndex];
    for (const childId of childrenByParentId.get(removedTakeId) ?? []) {
      if (removedTakeIds.has(childId)) continue;
      removedTakeIds.add(childId);
      removalQueue.push(childId);
    }
  }
  const takes = existing.takes.filter((take) => !removedTakeIds.has(take.id));
  return productionManifestSchema.parse({...existing, continuityLocks, shotSpecs, takes});
};
