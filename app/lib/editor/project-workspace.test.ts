import {describe, expect, it} from 'vitest';
import {PROJECT_WORKSPACES, getProjectWorkspaceLayout} from './project-workspace';

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
      '인터뷰',
      '기준 시트',
      '스토리보드',
      '영상 생성',
      '편집',
    ]);
  });

  it('편집만 타임라인과 소스 패널을 열고 나머지는 단계 전용 화면을 쓴다', () => {
    expect(getProjectWorkspaceLayout('edit')).toEqual({showSources: true, showTimeline: true});
    expect(getProjectWorkspaceLayout('interview')).toEqual({showSources: false, showTimeline: false});
    expect(getProjectWorkspaceLayout('storyboard')).toEqual({showSources: false, showTimeline: false});
  });
});
