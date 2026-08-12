---
title: VLOG 파이프라인 8단계 통합 계획 (인터뷰→이미지 콘티→캐릭터 시트→28축)
status: plan-only-not-implemented
created_at: 2026-08-12 11:20:00 +0900
source_commit: 980722d6f13380437b6508ec2a157cfc74e1bd07
working_branch: feat/vlog-pipeline-8stage
scope: design-plan-only-precedes-implementation
follows: byteplus-source-integration-plan.md (PR #15 merged → main @ 980722d)
---

# VLOG 파이프라인 8단계 통합 계획

> 이 문서는 **설계 계획**이며 코드 구현은 수행하지 않는다.
> PR #15(main @ 980722d)가 merge한 3단계 승인 파이프라인(creative→generation→release) 위에,
> 사용자가 지정한 8단계 VLOG 흐름(인터뷰 → 이미지 콘티 → 캐릭터 시트 → 28축)을 붙이는 설계다.

## 0. 배경 — 현재 코드의 격차

PR #15 기준 코드가 가진 것:
- ✅ 스토리보드(텍스트 JSON) 직접 입력 + `creativeApproval`
- ✅ 28축 빌더 직접 호출 → 프롬프트 종합 + `generationApproval`
- ✅ BytePlus adapter (canary 비활성, fail-closed)

**빠진 3단계** (사용자 8단계 중 미구현):
- ❌ ② LLM 인터뷰 (질의응답 → structured brief)
- ❌ ③ 이미지 콘티 생성 (storyboard-v2 스킬 연동, 텍스트→이미지)
- ❌ ④ 캐릭터 시트 추출/승인 (콘티 주체를 시각 자산으로 분리)

이 3단계를 어디에 끼울지가 이 계획의 핵심이다.

## 1. 운영 결론 (8단계 전체 매핑)

```
① 문장 입력
   └─ 사용자가 한 문장 던짐 (예: "고양이와 인사하는 30초 VLOG")
② LLM 인터뷰  [신규]
   └─ LLM이 대사/품종/톤/인사멘트 질의 → structured InterviewBrief
③ 이미지 콘티  [신규, storyboard-v2 스킬]
   └─ InterviewBrief → 컷별 이미지 콘티 (Seedance 2.5 t2i 또는 별도 이미지 모델)
④ 캐릭터 시트 [신규]
   └─ 콘티 속 주체(고양이)를 CharacterSheet로 추출
⑤ 캐릭터 승인 [게이트 1 = creativeApproval 확장]
   └─ 사용자 캐릭터 시트 확인
⑥ 스토리보드 조립 [기존 storyboardSchema 채움]
   └─ 이미지 콘티 → 텍스트 스토리보드(cuts/shots) 변환
⑦ 스토리보드 승인 [게이트 2 = creativeApproval]
   └─ 사용자 컷 구성 확인
⑧ 28축 프롬프트 종합 [기존 seedance-master-builder]
   └─ InterviewBrief + CharacterSheet + Storyboard → 28축 프롬프트
⑨ 프롬프트 확인 [게이트 3 = generationApproval]
   └─ 사용자 프롬프트 확인
⑩ 영상 생성 [기존 BytePlus adapter]
   └─ cat-vlog-30s.mp4
```

사용자 개입: **⑤·⑦·⑨** (3회). 자동: ②·③·④·⑥·⑧·⑩.

## 2. 신규 데이터 모델 (기존 schema.ts 확장)

### 2.1 InterviewBrief (신규)
```ts
export const interviewBriefSchema = z.object({
  subject: z.string(),          // "고양이"
  action: z.string(),           // "인사"
  durationSeconds: z.union([z.literal(20), z.literal(30)]),
  tone: z.string(),             // "포근한 오후"
  characterName: z.string(),    // "루이"
  characterBreed: z.string(),   // "폼메이션"
  greetingLine: z.string(),     // "안녕 나는 루이야🐾"
  extraNotes: z.string().optional(),
});
```

### 2.2 CharacterSheet (신규)
```ts
export const characterSheetSchema = z.object({
  name: z.string(),
  breed: z.string(),
  palette: z.object({dominant: z.string(), secondary: z.string(), accent: z.string()}),
  visualTags: z.array(z.string()),   // "크림색","큰 눈","귀 세움"
  referenceImageId: z.string().optional(), // ③ 이미지 콘티에서 생성된 주체 이미지
});
```
- `projectSchemaVersion: 3`의 `workflow`에 `characterSheet?: CharacterSheet` 필드 추가
- `creativeApproval`이 `characterSheetHash`를 포함하도록 확장 (캐릭터 통과=게이트1)

### 2.3 Storyboard (기존 유지)
- ③ 이미지 콘티는 **시각 자산**으로만 존재, ⑥에서 `storyboardSchema`(텍스트)로 변환
- 이미지 콘티 원본은 `mediaFiles`(role: 'storyboard') 또는 별도 `storyboardImages[]`로 영속

## 3. 신규 모듈 (app/lib 아래)

| 모듈 | 책임 | 연동 |
|---|---|---|
| `app/lib/interview/interview-agent.server.ts` | ② 한 문장→질의→InterviewBrief | LLM 호출 (Nous/DeepSeek) |
| `app/lib/storyboard/image-storyboard.ts` | ③ InterviewBrief→컷별 이미지 | storyboard-v2 스킬 + 이미지 생성 (t2i) |
| `app/lib/character/character-sheet.ts` | ④ 콘티→CharacterSheet 추출 | 이미지 분석 또는 LLM caption |
| `app/lib/workflow/seedance-master.ts` (확장) | ⑧ brief+character+storyboard→28축 | 기존 28축 엔진 입력 3종으로 확장 |

## 4. API 라우트 (신규, 기존 패턴 따름)

- `POST /api/projects/[id]/interview` — ② 시작/응답
- `POST /api/projects/[id]/storyboard/images` — ③ 이미지 콘티 생성 (canary 전까지 fake)
- `POST /api/projects/[id]/character-sheet` — ④ 추출
- 기존 `approve` 라우트는 `creativeApproval`에 `characterSheetHash` 포함하도록 확장

## 5. 승인 게이트 재매핑 (fail-closed 유지)

- **게이트 1 (캐릭터):** `creativeApproval.characterSheetHash` 서명
- **게이트 2 (스토리보드):** `creativeApproval.storyboardHash` 서명 (기존)
- **게이트 3 (생성):** `generationApproval` (기존, 28축 해시 포함)
- 변경 시 자동 무효화(invalidateForReleaseChange)는 기존 로직 재사용

## 6. 구현 순서 (브랜치 feat/vlog-pipeline-8stage)

1. `schema.ts` — InterviewBrief / CharacterSheet 스키마 + workflow 필드
2. `interview-agent.server.ts` + 라우트 (fake e2e부터)
3. `image-storyboard.ts` + 라우트 (canary 전 fake 이미지)
4. `character-sheet.ts` + 라우트
5. `seedance-master.ts` — 28축 입력 3종(brief+character+storyboard) 지원
6. `creativeApproval` — characterSheetHash 확장
7. UI: WorkflowPanel에 ②~⑤ 단계 추가
8. 테스트: 각 신규 모듈 `.server.test.ts` + 통합 e2e

## 7. 검증 게이트 (PR #15과 동일 기준)

- `type-check` 0에러
- `vitest` 신규 테스트 포함 통과
- `lint` 에러 0
- `next build` 성공
- `git diff --check` 통과
- 실제 유료(인터뷰/이미지/영상) 호출은 canary(env flag) 전 비활성

## 8. 잔여 리스크

- P0: 이미지 콘티 생성 모델 미정 (Seedance t2i vs 별도). canary 전까지 fake로 우회
- P1: 캐릭터 시트 추출 신뢰도 (이미지 분석 오차) → 사용자 게이트1에서 보정
- P1: ③ 이미지와 ⑧ 28축 프롬프트 간 시각 정합성 (캐릭터 참조 이미지를 28축 R2V에 넘길지 결정 needed)
