import {sha256} from './hash';
import {productionManifestSchema, type GenerationTake, type ProductionManifest} from './production-schema';

const pluralizedCharacter = (count: number): string => `${count} CHARACTER${count === 1 ? '' : 'S'}`;

export const compileShotPrompt = (input: ProductionManifest, shotSpecId: string): string => {
  const manifest = productionManifestSchema.parse(input);
  const shot = manifest.shotSpecs.find((candidate) => candidate.id === shotSpecId);
  if (!shot) throw new Error('Shot generation spec was not found.');
  const continuity = manifest.continuityLocks.find((candidate) => candidate.id === shot.continuityLockId);
  if (!continuity || continuity.status !== 'locked') throw new Error('Shot generation requires a locked continuity map.');
  const references = shot.activeReferences.map((reference) => {
    const asset = manifest.assets.find((candidate) => candidate.id === reference.assetId);
    if (!asset || asset.status !== 'locked') throw new Error(`Shot generation requires locked asset ${reference.assetId}.`);
    return `${asset.tag} — ${reference.role} reference\n${asset.descriptor}`;
  });
  const assetById = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  const acting = shot.acting.map((entry) => {
    const asset = assetById.get(entry.assetId);
    if (!asset || asset.status !== 'locked') throw new Error(`Acting direction requires locked asset ${entry.assetId}.`);
    return `${asset.tag}: ${entry.beats.join('; ')}`;
  });
  const blocking = shot.firstFrameBlocking.map((entry) => `${entry.subject}: ${entry.position}; ${entry.action}`);
  const landmarks = continuity.landmarks.map((landmark) => `${landmark.id}: ${landmark.description}; frame-${landmark.frameRegion}`);
  const timing = shot.actionBeats.map((beat) => `${beat.startSeconds.toFixed(3)}–${beat.endSeconds.toFixed(3)}s: ${beat.action}`);
  const prompt = [
    'SCENE CONTEXT',
    `CUT ${shot.cutId}; SHOT ${shot.shotId}; ${shot.durationSeconds.toFixed(3)} seconds`,
    `EXACT ${pluralizedCharacter(shot.characterCount)} — NO DUPLICATES`,
    '',
    'ACTIVE REFERENCES',
    references.length ? references.join('\n') : 'No active references.',
    '',
    'GEO SPATIAL LAYOUT',
    `Scene: ${continuity.sceneId}`,
    ...landmarks,
    `CAMERA SIDE: ${continuity.cameraSide}`,
    `180° AXIS: ${continuity.axisRule}`,
    `LIGHT SOURCE: ${continuity.lightSource}`,
    `SHADOW DIRECTION: ${continuity.shadowDirection}`,
    `PALETTE: ${continuity.palette.dominant}, ${continuity.palette.secondary}, ${continuity.palette.accent}`,
    '',
    'FIRST FRAME AND SPATIAL BLOCKING',
    ...(blocking.length ? blocking : ['Hold a one-second calibration frame before complex action.']),
    '',
    'FORMAT MODE',
    shot.format,
    '',
    'OPTICS',
    shot.optics,
    '',
    'CAMERA',
    ...(shot.camera.length ? shot.camera : ['locked camera']),
    '',
    'ACTION TIMING',
    ...timing,
    '',
    'PHYSICS',
    ...(shot.physics.length ? shot.physics : ['natural weight, contact, and inertia']),
    '',
    'LIGHTING',
    `Source: ${shot.lighting.source}`,
    `Direction: ${shot.lighting.direction}`,
    `Preserve continuity: ${shot.lighting.preserveContinuity ? 'yes' : 'no'}`,
    '',
    'AUDIO',
    `Dialogue: ${shot.audio.dialogue || '—'}`,
    `Ambience: ${shot.audio.ambience || '—'}`,
    `SFX: ${shot.audio.sfx || '—'}`,
    '',
    'CHARACTER ACTING',
    ...(acting.length ? acting : ['No character acting direction.']),
    '',
    'STYLE',
    ...(shot.style?.length ? shot.style : ['grounded action fantasy']),
    '',
    'QUALITY',
    shot.quality ?? 'stable anatomy, coherent motion, cinematic temporal consistency',
    'Coherent anatomy, stable identity, physically grounded motion, cinematic temporal consistency.',
    '',
    'POSITIVE CONSTRAINTS',
    ...(shot.positiveConstraints.length ? shot.positiveConstraints : ['preserve all locked production facts']),
  ].join('\n');
  return prompt;
};

export const computeProductionHash = async (manifest: ProductionManifest): Promise<string> =>
  sha256(productionManifestSchema.parse(manifest));

export type RecordTakeInput = {
  shotSpecId: string;
  parentTakeId?: string;
  provider: string;
  model: string;
  outputAssetId?: string;
  verdict: GenerationTake['verdict'];
  changedPath?: string;
  previousValue?: string;
  newValue?: string;
};

export const createGenerationTake = async (
  inputManifest: ProductionManifest,
  input: RecordTakeInput,
  now = new Date(),
): Promise<GenerationTake> => {
  const manifest = productionManifestSchema.parse(inputManifest);
  const shot = manifest.shotSpecs.find((candidate) => candidate.id === input.shotSpecId);
  if (!shot) throw new Error('Take shot generation spec was not found.');
  const continuity = manifest.continuityLocks.find((candidate) => candidate.id === shot.continuityLockId);
  if (!continuity || continuity.status !== 'locked') throw new Error('Take recording requires a locked continuity map.');
  const assets = shot.activeReferences.map((reference) => {
    const asset = manifest.assets.find((candidate) => candidate.id === reference.assetId);
    if (!asset || asset.status !== 'locked') throw new Error(`Take recording requires locked asset ${reference.assetId}.`);
    return asset;
  });
  if (input.parentTakeId && !manifest.takes.some((take) => take.id === input.parentTakeId)) throw new Error('Parent take was not found.');
  const prompt = compileShotPrompt(manifest, shot.id);
  const failureVerdicts = new Set<GenerationTake['verdict']>(['bad-roll', 'prompt-problem', 'rejected']);
  const priorFailures = manifest.takes.filter((take) => take.shotSpecId === shot.id && failureVerdicts.has(take.verdict)).length;
  const verdict = priorFailures >= 14 && failureVerdicts.has(input.verdict) ? 'simplify-shot' : input.verdict;
  const id = crypto.randomUUID();
  return {
    id,
    shotSpecId: shot.id,
    parentTakeId: input.parentTakeId,
    structuredSpecHash: await sha256(shot),
    compiledPromptHash: await sha256(prompt),
    assetBundleHash: await sha256(assets),
    continuityLockHash: await sha256(continuity),
    changedPath: input.changedPath,
    previousValueHash: input.previousValue === undefined ? undefined : await sha256(input.previousValue),
    newValueHash: input.newValue === undefined ? undefined : await sha256(input.newValue),
    provider: input.provider,
    model: input.model,
    outputAssetId: input.outputAssetId,
    verdict,
    selected: false,
    createdAt: now.toISOString(),
  };
};
