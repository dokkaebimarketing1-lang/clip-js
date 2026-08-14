import {describe, expect, it} from 'vitest';
import {initialState} from '@/app/store/slices/projectSlice';
import {createDefaultWorkflow} from '@/app/lib/workflow/schema';
import type {ProjectState} from '@/app/types';
import {deriveProjectCardProgress} from './project-card-progress';

const projectFor = (): ProjectState => ({
  ...structuredClone(initialState),
  id: 'project-card-progress',
  workflow: createDefaultWorkflow(),
});

describe('project card canonical progress', () => {
  it('빈 프로젝트는 기획 확정 단계 0%로 표시한다', async () => {
    await expect(deriveProjectCardProgress(projectFor())).resolves.toEqual({
      percent: 0,
      label: '기획 확정',
    });
  });

  it('고립된 승인 값과 임의 편집 자산으로 진행률을 올리지 않는다', async () => {
    const project = projectFor();
    project.workflow.planningStatus = 'approved';
    project.workflow.creativeApproval = {
      status: 'approved',
      storyboardHash: 'a'.repeat(64),
      characterSheetHash: 'b'.repeat(64),
    };
    project.mediaFiles = [{
      id: 'unrelated-upload',
      fileName: 'upload.mp4',
      type: 'video',
      includeInMerge: true,
    }] as ProjectState['mediaFiles'];

    await expect(deriveProjectCardProgress(project)).resolves.toEqual({
      percent: 0,
      label: '기획 확정',
    });
  });
});
