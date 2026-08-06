import type {CaptionKind, CaptionPreset, CaptionWordTiming} from '@/app/lib/workflow/schema';

export const CAPTION_FONT_FAMILY = 'Noto Sans KR Variable' as const;

export interface CaptionCatalogEntry {
  preset: CaptionPreset;
  kind: CaptionKind;
  label: string;
  description: string;
}

export const CAPTION_CATALOG: readonly CaptionCatalogEntry[] = [
  {preset: 'dialogue-clean', kind: 'dialogue', label: '대사 · 기본', description: '가독성 중심 하단 자막'},
  {preset: 'dialogue-speaker', kind: 'dialogue', label: '대사 · 화자', description: '화자 이름표가 포함된 대사'},
  {preset: 'dialogue-cinematic', kind: 'dialogue', label: '대사 · 시네마틱', description: '영화형 레터박스 자막'},
  {preset: 'word-highlight', kind: 'effect', label: '효과 · 단어 강조', description: '발화 중인 단어를 강조'},
  {preset: 'karaoke', kind: 'effect', label: '효과 · 카라오케', description: '단어 타이밍에 맞춘 색상 진행'},
  {preset: 'typewriter', kind: 'effect', label: '효과 · 타이프라이터', description: '문자를 순서대로 표시'},
  {preset: 'bounce', kind: 'effect', label: '효과 · 바운스', description: '단어별 튀어오르는 강조'},
  {preset: 'glow', kind: 'effect', label: '효과 · 글로우', description: '네온 발광 강조'},
  {preset: 'impact', kind: 'effect', label: '효과 · 임팩트', description: '충격형 확대 등장'},
  {preset: 'variety-sticker', kind: 'variety', label: '예능 · 스티커', description: '스티커형 상황 강조'},
  {preset: 'variety-shock', kind: 'variety', label: '예능 · 충격', description: '강한 테두리와 충격 모션'},
  {preset: 'variety-shake', kind: 'variety', label: '예능 · 흔들림', description: '프레임 결정적 흔들림'},
  {preset: 'reaction', kind: 'variety', label: '예능 · 리액션', description: '짧은 반응형 팝업'},
  {preset: 'thought', kind: 'variety', label: '예능 · 속마음', description: '말풍선형 속마음'},
  {preset: 'name-tag', kind: 'variety', label: '예능 · 인물명찰', description: '화자·출연자 이름표'},
  {preset: 'quote-card', kind: 'variety', label: '예능 · 인용카드', description: '핵심 문구 카드'},
] as const;

export const isCaptionPresetAllowedForKind = (preset: CaptionPreset, kind: CaptionKind): boolean => {
  if (['clean', 'bold-highlight', 'cinematic', 'shorts'].includes(preset)) return kind === 'dialogue';
  return CAPTION_CATALOG.some((entry) => entry.preset === preset && entry.kind === kind);
};

export const buildWordTimings = (text: string, startMs: number, endMs: number): CaptionWordTiming[] => {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0 || endMs <= startMs) return [];
  const duration = endMs - startMs;
  return words.map((word, index) => ({
    text: word,
    startMs: Math.round(startMs + duration * index / words.length),
    endMs: Math.round(startMs + duration * (index + 1) / words.length),
  }));
};
