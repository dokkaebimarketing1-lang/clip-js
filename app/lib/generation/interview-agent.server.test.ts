import {describe, expect, it} from 'vitest';
import {deriveInterviewBrief, deriveCharacterSheet} from './interview-agent.server';
import {interviewBriefSchema, characterSheetSchema} from '@/app/lib/workflow/schema';

describe('VLOG 파이프라인 인터뷰 에이전트 (fake)', () => {
  it('cat VLOG 문장에서 brief를 추출한다', () => {
    const brief = deriveInterviewBrief('고양이와 인사하는 30초 VLOG 만들어줘');
    expect(interviewBriefSchema.safeParse(brief).success).toBe(true);
    expect(brief).toMatchObject({subject: '고양이', durationSeconds: 30, characterName: '루이', characterBreed: '폼메이션'});
  });

  it('20초 문장은 20초로 해석한다', () => {
    const brief = deriveInterviewBrief('강아지와 인사하는 20초 브이로그');
    expect(brief.durationSeconds).toBe(20);
    expect(brief.subject).toBe('강아지');
  });

  it('주체 미지정 문장은 기본 주인공으로 fallback한다', () => {
    const brief = deriveInterviewBrief('인사하는 VLOG 만들어줘');
    expect(brief.subject).toBe('주인공');
    expect(brief.durationSeconds).toBe(30);
  });

  it('brief에서 캐릭터 시트를 규칙 기반으로 분리한다', () => {
    const brief = deriveInterviewBrief('고양이와 인사하는 30초 VLOG 만들어줘');
    const sheet = deriveCharacterSheet(brief);
    expect(characterSheetSchema.safeParse(sheet).success).toBe(true);
    expect(sheet.name).toBe('루이');
    expect(sheet.visualTags).toContain('고양이');
  });
});
