import type {ProjectState} from '@/app/types';
import {productionManifestSchema, type ProductionManifest} from './production-schema';
import {sha256} from './hash';
import {
  seedanceMasterSettingsSchema,
  storyboardSchema,
  type SeedanceMasterSettings,
  type Storyboard,
} from './schema';

export const generationInputs = (production: ProductionManifest): Omit<ProductionManifest, 'takes'> => {
  const parsed = productionManifestSchema.parse(production);
  return {
    assets: parsed.assets,
    continuityLocks: parsed.continuityLocks,
    shotSpecs: parsed.shotSpecs,
  };
};

export const computeProductionInputHash = async (production: ProductionManifest): Promise<string> =>
  sha256(generationInputs(production));

export const computeGenerationBlueprintHash = async (
  storyboard: Storyboard,
  production: ProductionManifest,
  seedanceMaster: SeedanceMasterSettings,
): Promise<string> => sha256({
  schemaVersion: 1,
  storyboard: storyboardSchema.parse(storyboard),
  productionInputs: generationInputs(production),
  seedanceMaster: seedanceMasterSettingsSchema.parse(seedanceMaster),
});

const renderableMedia = (project: ProjectState) => project.mediaFiles.map((media) => {
  const persisted = {...media};
  delete persisted.src;
  return persisted;
});

export const renderInputSnapshot = (project: ProjectState): unknown => ({
  schemaVersion: 1,
  projectId: project.id,
  mediaFiles: renderableMedia(project),
  textElements: project.textElements,
  shapes: project.shapes,
  duration: project.duration,
  resolution: project.resolution,
  fps: project.fps,
  aspectRatio: project.aspectRatio,
  exportSettings: project.exportSettings,
  workflow: {
    storyboard: project.workflow.storyboard,
    production: project.workflow.production,
    seedanceMaster: project.workflow.seedanceMaster,
    transitions: project.workflow.transitions,
    effects: project.workflow.effects,
    captions: project.workflow.captions,
    postProduction: project.workflow.postProduction,
  },
});

export const computeRenderInputHash = async (project: ProjectState): Promise<string> =>
  sha256(renderInputSnapshot(project));

export const assertRenderReleaseApproved = async (project: ProjectState): Promise<void> => {
  const approval = project.workflow.releaseApproval;
  if (approval.status !== 'approved' || !approval.renderInputHash) {
    throw new Error('A signed release approval is required for the exact render input.');
  }
  const currentHash = await computeRenderInputHash(project);
  if (currentHash !== approval.renderInputHash) {
    throw new Error('Render input changed after release approval.');
  }
};
