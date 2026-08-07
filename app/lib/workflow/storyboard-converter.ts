import {productionManifestSchema, type ProductionManifest, type SceneContinuityLock, type ShotGenerationSpec, type Storyboard} from './schema';

const placeholderLockFor = (cutId: string, title: string): SceneContinuityLock => ({
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
});

export const deriveProductionFromStoryboard = (
  storyboard: Storyboard,
  existing: ProductionManifest = {assets: [], continuityLocks: [], shotSpecs: [], takes: []},
): ProductionManifest => {
  const continuityLocks = [...existing.continuityLocks];
  const shotSpecs = [...existing.shotSpecs];
  storyboard.cuts.forEach((cut) => {
    const lockForCut = continuityLocks.find((lock) => lock.sceneId === cut.id);
    const lockId = lockForCut?.id ?? `continuity-lock-${cut.id}`;
    if (!lockForCut) continuityLocks.push(placeholderLockFor(cut.id, cut.title));
    cut.shots.forEach((shot) => {
      const alreadyDerived = shotSpecs.some((spec) => spec.cutId === cut.id && spec.shotId === shot.id);
      if (!alreadyDerived) shotSpecs.push(deriveSpecFor(cut.id, shot, lockId));
    });
  });
  return productionManifestSchema.parse({...existing, continuityLocks, shotSpecs});
};
