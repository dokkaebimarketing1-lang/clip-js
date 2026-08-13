import {describe, expect, it} from 'vitest';
import {deriveCreationProgress, isStoryboardBuiltFromCharacterReferences} from './creation-progress';

const styleHash = 'a'.repeat(64);
const styleBible = {visualMedium: 'photo', realism: 'natural', renderLanguage: 'cinematic', proportionRules: 'natural anatomy', lighting: 'soft studio', lensAndDepth: '50mm', background: 'neutral', textureAndColor: 'real fur', negativeConstraints: ['no cartoon']};

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
  it('rejects a storyboard created before the current character reference images existed', () => {
    const sheets = [{...character, referenceImageId: 'ga_a', referenceStyleHash: styleHash, styleReferenceImageIds: []}, {...character, name: '토리', referenceImageId: 'ga_b', referenceStyleHash: styleHash, styleReferenceImageIds: ['ga_a']}];
    const oldStoryboard = {version: 'v1', title: 'old', noBgm: true as const, cuts: []};
    const currentStoryboard = {...oldStoryboard, characterReferenceIds: ['ga_a', 'ga_b'], styleBibleHash: styleHash};
    expect(isStoryboardBuiltFromCharacterReferences(oldStoryboard, sheets)).toBe(false);
    expect(isStoryboardBuiltFromCharacterReferences(currentStoryboard, sheets, styleHash)).toBe(true);
  });
  it('shows a strong planning completion reveal and character CTA', () => {
    expect(deriveCreationProgress({brief, characterSheets: [character], hasStoryboard: false})).toEqual({
      state: 'plan-complete',
      completedCount: 3,
      nextWorkspace: 'reference',
      nextLabel: '캐릭터 기준 만들기',
    });
  });

  it('guides the user to register a character image when only text criteria exist', () => {
    expect(deriveCreationProgress({brief, characterSheets: [character], hasStoryboard: false, workspace: 'reference'})).toMatchObject({
      state: 'character-image-needed',
      nextLabel: '캐릭터 기준 이미지 등록',
    });
  });

  it('keeps legacy images locked for style review when provenance is absent', () => {
    expect(deriveCreationProgress({brief, styleBible, styleBibleHash: styleHash, characterSheets: [{...character, referenceImageId: 'ga_0123456789abcdef0123456789abcdef'}], hasStoryboard: false, workspace: 'reference'})).toMatchObject({state: 'style-review-needed'});
  });

  it('guides the user to generate a storyboard only after every image shares the style lineage', () => {
    expect(deriveCreationProgress({brief, styleBible, styleBibleHash: styleHash, characterSheets: [{...character, referenceImageId: 'ga_0123456789abcdef0123456789abcdef', referenceStyleHash: styleHash}], hasStoryboard: false, workspace: 'reference'})).toEqual({
      state: 'character-ready',
      completedCount: 4,
      nextLabel: '스토리보드 생성하기',
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
