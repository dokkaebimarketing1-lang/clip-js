import {describe, expect, it} from 'vitest';
import {
  PROJECT_WORKSPACES,
  getInitialProjectWorkspace,
  getProjectWorkspaceLayout,
  getWorkspaceInternalSteps,
  shouldShowSampleMedia,
} from './project-workspace';

describe('project workspace navigation', () => {
  it('프로젝트 왼쪽 탭을 제작 순서대로 제공한다', () => {
    expect(PROJECT_WORKSPACES.map((item) => item.id)).toEqual([
      'interview',
      'reference',
      'storyboard',
      'generation',
      'edit',
    ]);
    expect(PROJECT_WORKSPACES.map((item) => item.label)).toEqual([
      '기획',
      '캐릭터·스타일',
      '콘티·승인',
      '생성·검수',
      '편집·출력',
    ]);
  });

  it('편집만 타임라인과 소스 패널을 열고 나머지는 단계 전용 화면을 쓴다', () => {
    expect(getProjectWorkspaceLayout('edit')).toEqual({showSources: true, showTimeline: true});
    expect(getProjectWorkspaceLayout('interview')).toEqual({showSources: false, showTimeline: false});
    expect(getProjectWorkspaceLayout('storyboard')).toEqual({showSources: false, showTimeline: false});
  });

  it('재진입하면 저장된 제작 진행 상태가 있는 화면부터 보여준다', () => {
    expect(getInitialProjectWorkspace({planningApproved: false, hasStoryboard: false})).toBe('interview');
    expect(getInitialProjectWorkspace({planningApproved: true, hasStoryboard: false})).toBe('reference');
    expect(getInitialProjectWorkspace({planningApproved: true, hasStoryboard: true})).toBe('storyboard');
  });

  it('빈 프로젝트는 예시 자산을 자동 표시하지 않는다', () => {
    expect(shouldShowSampleMedia({sampleMode: false, mediaCount: 0})).toBe(false);
    expect(shouldShowSampleMedia({sampleMode: true, mediaCount: 0})).toBe(true);
    expect(shouldShowSampleMedia({sampleMode: true, mediaCount: 1})).toBe(false);
  });

  it('내부 8단계를 현재 사용자 단계의 하위 상태로만 제공한다', () => {
    expect(getWorkspaceInternalSteps('interview').map((step) => step.label)).toEqual(['아이디어 입력', 'AI 기획 초안', '기획 확정']);
    expect(getWorkspaceInternalSteps('reference').map((step) => step.label)).toEqual(['기준 이미지', '화풍 영향 확인', 'Style Bible·기준 화풍 확정', '전체 캐릭터 확정']);
    expect(getWorkspaceInternalSteps('storyboard').map((step) => step.label)).toEqual(['콘티 생성', '컷·샷 검수', '콘티 전체 승인']);
    expect(getWorkspaceInternalSteps('generation').map((step) => step.label)).toEqual(['생성 사양·비용', '생성 실행 승인', '유료 제출', '결과 승인·반려']);
    expect(getWorkspaceInternalSteps('edit').map((step) => step.label)).toEqual(['승인 생성본 배치', '타임라인 편집', '최종 출력 승인', '최종 렌더']);
  });
});
