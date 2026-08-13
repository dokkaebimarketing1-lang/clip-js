import {describe, expect, it} from 'vitest';
import {deriveCreationProgress} from './creation-progress';

const brief = {
  subject: '크림색 시바견 루이',
  action: '카메라를 바라보며 인사한다',
  durationSeconds: 20 as const,
  tone: '따뜻하고 자연스러운 분위기',
  greetingLine: '안녕하세요',
};

const character = {
  name: '루이',
  breed: '크림색 시바견',
  palette: {dominant: '#cccccc', secondary: '#888888', accent: '#ffd43b'},
  visualTags: ['부드러운 털', '갈색 눈'],
};

describe('creation progress guidance', () => {
  it('shows a strong planning completion reveal and character CTA', () => {
    expect(deriveCreationProgress({brief, characterSheets: [character], hasStoryboard: true})).toEqual({
      state: 'plan-complete',
      completedCount: 3,
      nextWorkspace: 'reference',
      nextLabel: '캐릭터 기준 만들기',
    });
  });

  it('guides the user to register a character image when only text criteria exist', () => {
    expect(deriveCreationProgress({brief, characterSheets: [character], hasStoryboard: true, workspace: 'reference'})).toMatchObject({
      state: 'character-image-needed',
      nextLabel: '캐릭터 기준 이미지 등록',
    });
  });

  it('guides the user to storyboard after a managed character image is registered', () => {
    expect(deriveCreationProgress({brief, characterSheets: [{...character, referenceImageId: 'ga_0123456789abcdef0123456789abcdef'}], hasStoryboard: true, workspace: 'reference'})).toEqual({
      state: 'character-ready',
      completedCount: 4,
      nextWorkspace: 'storyboard',
      nextLabel: '스토리보드 검수하기',
    });
  });

  it('keeps storyboard locked until every main character has a reference image', () => {
    expect(deriveCreationProgress({
      brief,
      characterSheets: [
        {...character, id: 'CHAR01', referenceImageId: 'ga_0123456789abcdef0123456789abcdef'},
        {...character, id: 'CHAR02', name: '토리', breed: '다람쥐'},
      ],
      hasStoryboard: true,
      workspace: 'reference',
    })).toMatchObject({state: 'character-image-needed'});
  });
});
