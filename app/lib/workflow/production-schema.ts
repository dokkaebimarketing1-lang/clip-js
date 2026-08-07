import {z} from 'zod';

const boundedId = z.string().min(1).max(128);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const assetStressTestSchema = z.object({
  id: boundedId,
  pose: z.string().min(1).max(300),
  lighting: z.string().min(1).max(300),
  coAssetIds: z.array(boundedId).max(20).default([]),
  resultAssetId: boundedId,
  verdict: z.enum(['pass', 'revise', 'reject']),
});

export const productionAssetSchema = z.object({
  id: boundedId,
  tag: z.string().regex(/^@[a-z0-9][a-z0-9_-]{0,62}$/),
  type: z.enum(['character', 'location', 'prop', 'crowd']),
  state: z.string().min(1).max(80),
  descriptor: z.string().min(1).max(4000),
  referenceUrl: z.string().url().max(4096),
  referenceHash: sha256Schema,
  parentAssetId: boundedId.optional(),
  editMode: z.enum(['original', 'full-regeneration', 'masked-point-edit', 'crop', 'upscale', 'color-only']),
  status: z.enum(['draft', 'stress-tested', 'locked']),
  stressTests: z.array(assetStressTestSchema).max(10).default([]),
}).superRefine((asset, ctx) => {
  if (asset.status === 'locked' && (asset.stressTests.length !== 10 || asset.stressTests.some((test) => test.verdict !== 'pass'))) {
    ctx.addIssue({code: z.ZodIssueCode.custom, path: ['stressTests'], message: 'Locked assets require exactly ten passing stress tests.'});
  }
});

export const sceneContinuityLockSchema = z.object({
  id: boundedId,
  sceneId: boundedId,
  status: z.enum(['draft', 'locked']),
  landmarks: z.array(z.object({
    id: boundedId,
    description: z.string().min(1).max(500),
    frameRegion: z.enum(['left', 'center', 'right']),
  })).max(20),
  cameraSide: z.string().min(1).max(500),
  axisRule: z.string().min(1).max(1000),
  lightSource: z.string().min(1).max(500),
  shadowDirection: z.string().min(1).max(500),
  palette: z.object({
    dominant: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    secondary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
});

export const shotGenerationSpecSchema = z.object({
  id: boundedId,
  cutId: boundedId,
  shotId: boundedId,
  durationSeconds: z.number().positive().max(120),
  characterCount: z.number().int().min(0).max(20),
  format: z.enum(['single-take', 'hard-cuts']),
  activeReferences: z.array(z.object({assetId: boundedId, role: z.enum(['identity', 'location', 'prop', 'first-frame'])})).max(20),
  continuityLockId: boundedId,
  firstFrameBlocking: z.array(z.object({
    subject: z.string().min(1).max(128),
    position: z.string().min(1).max(300),
    action: z.string().min(1).max(300),
  })).max(20),
  optics: z.enum(['18mm', '24mm', '35mm', '50mm', '85mm', 'telephoto', 'macro']),
  camera: z.array(z.string().min(1).max(500)).max(10),
  actionBeats: z.array(z.object({
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive(),
    action: z.string().min(1).max(1000),
  }).refine((beat) => beat.endSeconds > beat.startSeconds, 'Action beat end must be after start')).min(1).max(30),
  physics: z.array(z.string().min(1).max(500)).max(20),
  lighting: z.object({
    source: z.string().min(1).max(500),
    direction: z.string().min(1).max(300),
    preserveContinuity: z.boolean(),
  }),
  audio: z.object({dialogue: z.string().max(2000), ambience: z.string().max(1000), sfx: z.string().max(1000)}),
  acting: z.array(z.object({assetId: boundedId, beats: z.array(z.string().min(1).max(500)).max(20)})).max(20),
  positiveConstraints: z.array(z.string().min(1).max(500)).max(30),
  style: z.array(z.string().min(1).max(300)).max(10).optional(),
  quality: z.string().min(1).max(500).optional(),
}).superRefine((shot, ctx) => {
  shot.actionBeats.forEach((beat, index) => {
    if (beat.endSeconds > shot.durationSeconds) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['actionBeats', index], message: 'Action beat must stay within shot duration.'});
  });
});

export const generationTakeSchema = z.object({
  id: boundedId,
  shotSpecId: boundedId,
  parentTakeId: boundedId.optional(),
  structuredSpecHash: sha256Schema,
  compiledPromptHash: sha256Schema,
  assetBundleHash: sha256Schema,
  continuityLockHash: sha256Schema,
  changedPath: z.string().min(1).max(500).optional(),
  previousValueHash: sha256Schema.optional(),
  newValueHash: sha256Schema.optional(),
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(200),
  outputAssetId: boundedId.optional(),
  verdict: z.enum(['pending', 'accepted', 'bad-roll', 'prompt-problem', 'simplify-shot', 'rejected']),
  createdAt: z.string().datetime(),
}).superRefine((take, ctx) => {
  const hasDiffHashes = Boolean(take.previousValueHash && take.newValueHash);
  if (Boolean(take.changedPath) !== hasDiffHashes) ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Take diff provenance requires changedPath plus both value hashes.'});
});

export const productionManifestSchema = z.object({
  assets: z.array(productionAssetSchema).max(500).default([]),
  continuityLocks: z.array(sceneContinuityLockSchema).max(500).default([]),
  shotSpecs: z.array(shotGenerationSpecSchema).max(2000).default([]),
  takes: z.array(generationTakeSchema).max(10000).default([]),
}).superRefine((manifest, ctx) => {
  const assetIds = new Set(manifest.assets.map((asset) => asset.id));
  const assetTags = new Set(manifest.assets.map((asset) => asset.tag));
  const lockIds = new Set(manifest.continuityLocks.map((lock) => lock.id));
  const shotIds = new Set(manifest.shotSpecs.map((shot) => shot.id));
  const takeIds = new Set(manifest.takes.map((take) => take.id));
  if (assetIds.size !== manifest.assets.length) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['assets'], message: 'Production asset IDs must be unique.'});
  if (assetTags.size !== manifest.assets.length) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['assets'], message: 'Production asset tags must be unique.'});
  if (lockIds.size !== manifest.continuityLocks.length) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['continuityLocks'], message: 'Continuity lock IDs must be unique.'});
  if (shotIds.size !== manifest.shotSpecs.length) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['shotSpecs'], message: 'Shot spec IDs must be unique.'});
  if (takeIds.size !== manifest.takes.length) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['takes'], message: 'Take IDs must be unique.'});
  manifest.assets.forEach((asset, index) => {
    if (asset.parentAssetId && (!assetIds.has(asset.parentAssetId) || asset.parentAssetId === asset.id)) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['assets', index, 'parentAssetId'], message: 'Asset parent must reference another production asset.'});
  });
  manifest.shotSpecs.forEach((shot, index) => {
    if (!lockIds.has(shot.continuityLockId)) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['shotSpecs', index, 'continuityLockId'], message: 'Shot spec continuity lock does not exist.'});
    shot.activeReferences.forEach((reference, referenceIndex) => {
      if (!assetIds.has(reference.assetId)) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['shotSpecs', index, 'activeReferences', referenceIndex], message: 'Shot reference asset does not exist.'});
    });
    shot.acting.forEach((acting, actingIndex) => {
      if (!assetIds.has(acting.assetId)) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['shotSpecs', index, 'acting', actingIndex], message: 'Acting asset does not exist.'});
    });
  });
  manifest.takes.forEach((take, index) => {
    if (!shotIds.has(take.shotSpecId)) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['takes', index, 'shotSpecId'], message: 'Take shot spec does not exist.'});
    if (take.parentTakeId && (!takeIds.has(take.parentTakeId) || take.parentTakeId === take.id)) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['takes', index, 'parentTakeId'], message: 'Take parent must reference another take.'});
  });
});

export type ProductionAsset = z.infer<typeof productionAssetSchema>;
export type SceneContinuityLock = z.infer<typeof sceneContinuityLockSchema>;
export type ShotGenerationSpec = z.infer<typeof shotGenerationSpecSchema>;
export type GenerationTake = z.infer<typeof generationTakeSchema>;
export type ProductionManifest = z.infer<typeof productionManifestSchema>;

export const createDefaultProductionManifest = (): ProductionManifest => ({
  assets: [], continuityLocks: [], shotSpecs: [], takes: [],
});
