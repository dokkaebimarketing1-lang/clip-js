import type {InterviewBrief, CharacterSheet} from '@/app/lib/workflow/schema';
import {interviewBriefSchema, characterSheetSchema} from '@/app/lib/workflow/schema';

/**
 * VLOG 파이프라인 8단계 · 단계 ② (LLM 인터뷰)
 *
 * 실제 운영에서는 이 함수가 LLM과 질의응답하여 structured brief를 만든다.
 * 이 구현은 compile/fake 단계이며 외부 LLM 호출 없이 한 문장에서
 * 정규식/키워드 기반으로 최소 brief를 추출한다. (canary 전까지 fake)
 *
 * fail-closed: 외부 모델 호출은 수행하지 않으며, 결정적 규칙만 사용한다.
 */
export const deriveInterviewBrief = (sentence: string): InterviewBrief => {
  const text = sentence.trim();
  const lower = text.toLowerCase();

  const hasCat = /고양이|냥이|캣|cat|키티/.test(lower);
  const hasDog = /강아지|멍멍|도그|dog/.test(lower);
  const subject = hasCat ? '고양이' : hasDog ? '강아지' : '주인공';

  const matches = text.match(/(?:인사|greeting|안녕)[^"']{0,40}/i);
  const greetingLine = matches ? matches[0].trim() : `${subject}와 인사하는 순간`;

  const actionMatch = text.match(/(?:만들어|촬영|찍|vlog|브이로그)[^"']{0,30}/i);
  const action = actionMatch ? actionMatch[0].trim() : '일상 브이로그';

  const durationSeconds = /20초|20\s*초/.test(text) ? 20 : 30;

  return interviewBriefSchema.parse({
    subject,
    action,
    durationSeconds,
    tone: '자연스러운 일상',
    characterName: subject === '고양이' ? '루이' : undefined,
    characterBreed: hasCat ? '폼메이션' : undefined,
    greetingLine,
    extraNotes: text,
  });
};

/**
 * VLOG 파이프라인 8단계 · 단계 ④ (캐릭터 시트 추출)
 *
 * 인터뷰 brief에서 주체 캐릭터 시트를 규칙 기반으로 분리한다.
 * 실제 운영에서는 이미지 콘티(단계 ③)에서 추출된 시각 특징을 병합한다.
 */
export const deriveCharacterSheet = (brief: InterviewBrief): CharacterSheet => characterSheetSchema.parse({
  name: brief.characterName || brief.subject,
  breed: brief.characterBreed,
  palette: {dominant: '#cccccc', secondary: '#888888', accent: '#ffd43b'},
  visualTags: [brief.subject, brief.characterBreed].filter(Boolean) as string[],
  referenceImageId: undefined,
});
