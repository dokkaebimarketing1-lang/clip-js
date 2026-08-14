import {describe, expect, it} from 'vitest';
import {initialState} from '@/app/store/slices/projectSlice';
import {approveCreative, approveGeneration} from '@/app/lib/workflow/approval';
import {deriveProductionFromStoryboard} from '@/app/lib/workflow/storyboard-converter';
import {sha256} from '@/app/lib/workflow/hash';
import {characterSheetSchema, createDefaultWorkflow, storyboardSchema, styleBibleSchema, type WorkflowState} from '@/app/lib/workflow/schema';
import type {MediaFile, ProjectState} from '@/app/types';
import {deriveStageStepStates} from './stage-status';

const staleStyleHash = 'a'.repeat(64);
const anchorId = `ga_${'1'.repeat(32)}`;
const sheet = characterSheetSchema.parse({
  id: 'CHAR01', name: '초코', visualTags: ['강아지'], referenceImageId: anchorId,
  referenceStyleHash: staleStyleHash, styleReferenceImageIds: [],
});
const styleBible = styleBibleSchema.parse({
  anchorReferenceImageId: anchorId,
  anchorContentSha256: 'b'.repeat(64),
  visualMedium: '3D animation', realism: 'stylized', renderLanguage: 'soft shapes',
  proportionRules: 'consistent proportions', lighting: 'soft daylight', lensAndDepth: '35mm shallow depth',
  background: 'clean interior', textureAndColor: 'warm pastel', negativeConstraints: ['text', 'logo'],
});
const storyboard = storyboardSchema.parse({
  version: 'storyboard-v2', title: '검수할 콘티', noBgm: true,
  styleBibleHash: staleStyleHash, characterReferenceIds: [anchorId],
  cuts: [{
    id: 'CUT01', title: '첫 장면', absoluteStartSeconds: 0, absoluteEndSeconds: 4, characterIds: ['CHAR01'],
    shots: [{id: 'S1', startSeconds: 0, endSeconds: 4, startFrame: '시작', endFrame: '끝', camera: '고정', action: '인사한다', dialogue: '안녕', sfx: '바람'}],
  }],
});

const projectFor = (workflow: WorkflowState = createDefaultWorkflow(), mediaFiles: MediaFile[] = []): ProjectState => ({
  ...structuredClone(initialState), id: 'project-stage-status', workflow, mediaFiles,
});
const currentWorkflow = async (): Promise<WorkflowState> => {
  const workflow = createDefaultWorkflow();
  const styleHash = await sha256(styleBible);
  const currentSheet = characterSheetSchema.parse({...sheet, referenceStyleHash: styleHash});
  const currentStoryboard = storyboardSchema.parse({...storyboard, styleBibleHash: styleHash});
  workflow.characterSheet = currentSheet;
  workflow.characterSheets = [currentSheet];
  workflow.styleBible = styleBible;
  workflow.styleBibleHash = styleHash;
  workflow.storyboard = currentStoryboard;
  workflow.creativeApproval = await approveCreative(currentStoryboard, 'owner', new Date('2026-08-14T00:00:00Z'), [currentSheet]);
  workflow.production = deriveProductionFromStoryboard(currentStoryboard, workflow.production);
  return workflow;
};
const statesFor = (project: ProjectState, workspace: 'interview' | 'reference' | 'storyboard' | 'generation' | 'edit' = 'interview', hasSubmittedGeneration = false) =>
  deriveStageStepStates({workspace, project, hasSubmittedGeneration});

describe('pipeline-aligned stage status', () => {
  it('빈 프로젝트에서는 아이디어 입력만 지금 할 일이다', async () => {
    const states = await statesFor(projectFor());
    expect(states.idea).toBe('current');
    expect(states['planning-draft']).toBe('waiting');
    expect(states['creative-approval']).toBe('waiting');
  });

  it('provenance 없는 storyboard 객체를 콘티 완료로 표시하지 않는다', async () => {
    const workflow = createDefaultWorkflow();
    workflow.storyboard = storyboard;
    const states = await statesFor(projectFor(workflow), 'storyboard');
    expect(states.storyboard).toBe('current');
    expect(states['shot-review']).toBe('waiting');
    expect(states['creative-approval']).toBe('waiting');
  });

  it('현재 storyboard와 character hash가 다른 Creative 승인을 완료로 표시하지 않는다', async () => {
    const workflow = await currentWorkflow();
    workflow.creativeApproval = {...workflow.creativeApproval, storyboardHash: 'c'.repeat(64)};
    const states = await statesFor(projectFor(workflow), 'storyboard');
    expect(states.storyboard).toBe('complete');
    expect(states['shot-review']).toBe('current');
    expect(states['creative-approval']).toBe('waiting');
  });

  it('Style Bible anchor가 실제 lineage root와 다르면 확정 완료로 표시하지 않는다', async () => {
    const workflow = await currentWorkflow();
    workflow.styleBible = {...styleBible, anchorReferenceImageId: `ga_${'2'.repeat(32)}`};
    const states = await statesFor(projectFor(workflow), 'reference');
    expect(states['character-images']).toBe('complete');
    expect(states['style-anchor']).toBe('current');
    expect(states['style-bible']).toBe('waiting');
  });

  it('Style Bible 본문이 현재 hash와 다르면 storyboard와 downstream 승인을 완료로 표시하지 않는다', async () => {
    const workflow = await currentWorkflow();
    workflow.generationApproval = await approveGeneration(workflow.storyboard!, workflow.production, workflow.seedanceMaster, 'owner');
    workflow.styleBible = {...styleBible, lighting: '변경된 조명'};

    const storyboardStates = await statesFor(projectFor(workflow), 'storyboard');
    const generationStates = await statesFor(projectFor(workflow), 'generation', true);

    expect(storyboardStates.storyboard).toBe('current');
    expect(storyboardStates['creative-approval']).toBe('waiting');
    expect(generationStates['generation-approval']).toBe('waiting');
    expect(generationStates['generation-job']).toBe('waiting');
  });

  it('현재 blueprint exact-match Generation 승인과 제출 상태를 분리한다', async () => {
    const workflow = await currentWorkflow();
    workflow.generationApproval = await approveGeneration(workflow.storyboard!, workflow.production, workflow.seedanceMaster, 'owner');
    const project = projectFor(workflow);
    expect((await statesFor(project, 'generation'))['generation-approval']).toBe('complete');
    expect((await statesFor(project, 'generation'))['generation-job']).not.toBe('complete');
    expect((await statesFor(project, 'generation', true))['generation-job']).toBe('complete');
    workflow.production.shotSpecs[0].camera = ['변경된 카메라'];
    expect((await statesFor(project, 'generation'))['generation-approval']).not.toBe('complete');
  });

  it('임의 미디어가 아니라 선택·승인된 생성본과 연결된 타임라인만 완료 처리한다', async () => {
    const workflow = await currentWorkflow();
    workflow.production.takes = [{id: 'take-1', selected: true, takeApproval: {status: 'approved'}}] as WorkflowState['production']['takes'];
    const unrelated = {id: 'upload-1', fileName: 'upload.mp4', type: 'video', includeInMerge: true} as MediaFile;
    expect((await statesFor(projectFor(workflow, [unrelated]), 'edit')).timeline).not.toBe('complete');
    const linked = {...unrelated, id: 'generated-1', takeId: 'take-1'};
    expect((await statesFor(projectFor(workflow, [linked]), 'edit')).timeline).toBe('complete');
  });

  it('고립되거나 stale인 승인 값을 완료로 표시하지 않는다', async () => {
    const workflow = createDefaultWorkflow();
    workflow.planningStatus = 'approved';
    workflow.creativeApproval = {status: 'approved', storyboardHash: 'a'.repeat(64), characterSheetHash: 'b'.repeat(64)};
    workflow.generationApproval = {status: 'approved', generationBlueprintHash: 'c'.repeat(64)};
    workflow.releaseApproval = {status: 'approved', renderInputHash: await sha256({stale: true})};
    const states = await statesFor(projectFor(workflow), 'generation', true);
    expect(states['planning-approval']).not.toBe('complete');
    expect(states['creative-approval']).not.toBe('complete');
    expect(states['generation-approval']).not.toBe('complete');
    expect(states['generation-job']).not.toBe('complete');
    expect(states['release-approval']).not.toBe('complete');
  });
});
