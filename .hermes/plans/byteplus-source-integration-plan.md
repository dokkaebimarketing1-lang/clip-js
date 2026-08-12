---
title: Seedance 2.5 원본 빌더 × ClipJS × BytePlus 직접 API 통합 계획
status: implemented-verified-awaiting-paid-canary
created_at: 2026-08-11 12:57:18 +0900
source_commit: 71d3e34eef573d44b9caf06175c38d29297c6dfc
working_branch: feat/byteplus-seedance-direct
scope: implementation-and-fake-e2e-complete-no-paid-canary
---

# Seedance 2.5 원본 빌더 × ClipJS × BytePlus 직접 API 통합 계획

> 사용자 문장의 `모굪`은 문맥상 `목표`로 해석했다.
>
> 이 문서는 구현 계획이며 코드 구현이나 유료 생성은 수행하지 않는다.

## 1. 운영 결론

새 편집기를 다시 만들거나 원본 HTML을 iframe으로 끼워 넣지 않는다. 다음 세 층을 결합한다.

1. **원본 빌더의 판단 엔진**: `D:\비디오자동화\.hermes\desktop-attachments\seedance-master-builder.html`
   - 28축 정의, 선택지, `requires` 잠금, 5종 판정, 프롬프트 블록 순서를 연출 정본으로 사용한다.
   - 모델 ID·endpoint·request 필드·지원 범위는 정본으로 취급하지 않고 BytePlus 공식 문서만 따른다.
2. **GitHub ClipJS의 제작·보안 엔진**: `dokkaebimarketing1-lang/clip-js@71d3e34`
   - 프로젝트 상태, Storyboard/Production Blueprint, 승인 서명, 중복 과금 방지, Take Ledger, 미디어 검증, 타임라인, Remotion 렌더를 유지한다.
3. **BytePlus ModelArk 공식 생성 엔진**
   - `dreamina-seedance-2-5-260628`를 서버에서 직접 호출하고, 생성 작업과 결과를 ClipJS가 소유한다.

최종 경로:

```text
사용자 주제·핵심 콘셉트
→ 스토리보드/콘티 승인
→ Production Blueprint + 원본 28축 판단 엔진
→ 공식 BytePlus 요청으로 컴파일
→ 승인 버전에 묶인 1회 제출
→ 작업 상태 영구 저장·자동 조회
→ 결과 즉시 영구 회수·ffprobe 검증
→ Take Ledger 후보 등록·사람의 Take 승인
→ 승인된 Take만 타임라인에 영속적으로 1회 삽입
→ 정확한 한국어 음성·효과음·UI·자막 후편집
→ Remotion 최종 렌더·다운로드
```

### 1.1 재검토에서 확인된 강제 수정 사항

다음은 구현 선택지가 아니라 충돌 방지를 위한 불변 조건이다.

1. 원본 HTML의 `doubao-seedance-2-5-260628`는 Volcengine 계열 명명이며, BytePlus 공식 tutorial의 `dreamina-seedance-2-5-260628`와 다르다. 원본 파라미터를 golden parity로 고정하지 않는다.
2. 원본의 텍스트 생성 선택지, provider ID, model-specific 지원이 공식적으로 확인되지 않은 `seed`/`camera_fixed`, legacy CLI 표현은 이식 예외다. 현재 무문자 정책과 공식 2.5 지원표가 우선한다.
3. Redux reducer 한 번은 IndexedDB까지 원자적이라는 뜻이 아니다. autosave 오류를 먼저 표면화하고, durable transaction/ack가 끝난 뒤에만 성공을 표시한다.
4. 서버 Job Repository가 작업 상태의 유일한 정본이다. 프로젝트의 `generationJobs`는 다시 동기화 가능한 projection/cache일 뿐 두 번째 정본이 아니다.
5. 결과는 ffprobe 통과만으로 광고 승인 자산이 아니다. `qc_pending` 후보 Take로 등록하고 무문자·인물·브랜드·오디오 검수 후 승인된 Take만 타임라인에 넣는다.
6. 승인에는 만료되는 signed URL이 아니라 참조 자산의 immutable SHA-256을 묶는다. provider transport URL은 같은 hash의 자산에 대해 서버가 제출 직전에 만든다.
7. 브라우저용 미디어 URL과 Remotion용 서버 자산 경로를 분리한다. localhost 자산 URL을 SSRF 검사 대상 remote URL로 재다운로드하지 않는다.
8. 기존 generation approval만으로 최종 render를 승인하지 않는다. 최종 media/timeline/text/caption/effect/export/post-production hash에 대한 별도 signed ReleaseApproval을 추가한다.
9. fork와 upstream의 `LICENSE`는 GitHub API와 `HEAD:LICENSE`에서 MIT로 확인됐다. 원본 copyright와 MIT 고지를 배포물에 유지한다.

## 2. 비교 대상

### 2.1 원본 빌더

| 항목 | 확인된 상태 |
|---|---|
| 파일 | `seedance-master-builder.html` |
| 규모 | 1,482줄, 약 63K 문자 |
| UI | 한국어 |
| 생성 프롬프트 | 중국어 |
| 대사 정책 | 한국어·서울 억양 |
| 판단 축 | 28개 |
| 공식 작업 유형 | t2v, reference, edit, extension, first/last frame |
| 조건부 UI | `requires`, R2V 전용 축, 잠금 표시 |
| API 파라미터 | model, resolution, ratio, duration, generate_audio, output_format, watermark, return_last_frame |
| 편의 기능 | 검색, 필수축 필터, 프리셋 저장/복원, 선택 요약 |
| 약점 | 단일 HTML/localStorage이며 프로젝트 승인, 서버 API, 작업 복구, 타임라인, 렌더가 없음 |

### 2.2 GitHub ClipJS

| 항목 | 확인된 상태 |
|---|---|
| 기준 | `main` 커밋 `71d3e34` |
| 규모 | 빌드 산출물 제외 128개 소스 파일, 약 11,196줄 |
| 편집 | React/Redux 타임라인, 미디어, 텍스트, 자막, 효과, 전환 |
| 제작 데이터 | Storyboard, Production Blueprint, Asset Registry V2, Take Ledger |
| 28축 | Zod schema와 React UI로 대부분 포팅됨 |
| 승인 | storyboard + production + Seedance 설정 해시 및 서버 서명 |
| 과금 방지 | 원자적 파일 claim, completed/uncertain 보존 |
| 보안 | agent/owner 토큰 분리, 요청 크기 제한, SSRF/DNS pinning, MIME·magic-byte·ffprobe 검증 |
| 렌더 | Remotion 서버 렌더, 직렬 큐, timeout, 서명 다운로드 |
| 저장 | 브라우저 IndexedDB 중심 |
| 현재 공급자 | Higgsfield 전용 이름·CLI·route |
| 현재 단절 | 생성 완료 조회, 결과 영구 회수, Take 등록과 타임라인 삽입의 원자성, 오디오·UI 후처리 자동 연결 |

### 2.3 실제 `D:\비디오자동화` 제작 프로젝트

| 자산 | 현재 역할 | 문제 |
|---|---|---|
| `*.storyboard.json` | 콘티 원본 | 프로젝트별 수동 관리 |
| `*-감독-manifest.json` | 인물·공간·샷 연속성 | ClipJS Production과 중복 |
| `*-prompt.txt` | 감독 프롬프트 | 빌더/프로젝트 상태와 분리 |
| `reference-pack*` | 참조 이미지 | Asset Registry에 자동 등록되지 않음 |
| 생성 MP4·QA PNG | Take와 검수 결과 | 파일명 중심이라 provenance가 약함 |
| 나레이션 MP3 | 후더빙 | 대사·타임라인과 자동 동기화되지 않음 |
| concat 목록·Python 스크립트 | 수동 후처리 | ClipJS 타임라인/렌더와 중복 |

### 2.4 최종 목표와 현재 격차

| 목표 | 현재 | 필요한 연결 |
|---|---|---|
| 참신한 콘티를 승인하고 생성 | 승인 구조는 있음 | 생성 전에 콘티 승인 화면과 유료 버튼을 강하게 분리 |
| 원본 28축 판단을 그대로 활용 | schema는 있으나 원본과 중복 정의 | 단일 canonical catalog + golden parity 테스트 |
| 공식 Seedance 2.5 직접 API | Higgsfield CLI | 공급자 중립 계약 + BytePlus adapter |
| 소리가 있는 원본 | `generateAudio` 선택 가능하나 최근 false | 오디오 정책 검증 + 기본값/경고 + 후더빙 recipe |
| 결과 자동 회수 | 없음 | 작업 저장·poll·다운로드·검증·영구 보관 |
| 후편집 자동 연결 | 수동 import | durable IndexedDB transaction + Redux projection commit |
| 정확한 UI·문자 | 생성 단계 금지 완료 | 안전 화면 영역에 ClipJS overlay recipe 적용 |
| 재시작 후 복구 | 브라우저 job 상태 없음 | 서버 Job Repository + project job receipt |
| 중복 과금 0 | 단일 호스트 claim | provider-neutral idempotency + 공유 저장소 인터페이스 |

## 3. 재사용·어댑터·폐기 결정

### 3.1 그대로 재사용

- `app/lib/workflow/approval.ts`
- `app/lib/security/approval-signature.ts`
- `app/lib/security/api-auth.ts`
- `app/lib/security/request-body.ts`
- `app/lib/security/remote-url*.ts`
- `app/lib/render/stage-remote-media.ts`
- `app/lib/render/media-probe.ts`
- `app/lib/render/serial-task-queue.ts`
- `app/lib/render/timeout.ts`
- `app/lib/render/remotion.ts`
- Storyboard, Production Blueprint, Asset Registry V2, Take Ledger 개념
- Redux 타임라인 및 Remotion composition
- 무문자 생성 정책과 legacy migration

### 3.2 원본에서 정확히 이식

- 28개 AXES의 id, option, value, tag, type, requires
- 공식 5종 작업 판정과 잠금 규칙
- 편집/연장/시작·끝 프레임의 adaptive/duration 제약
- 20초 4단계·30초 5단계 시간 구간 생성
- 1컷 1운경 규칙
- 대사 `{}`, 효과음 `<>`, 음악 `()`, 후편집 자막 구분
- 스타일 정방향·역방향 제외 규칙
- 프롬프트 블록 순서와 전역 일관성 블록
- API 파라미터를 프롬프트 밖으로 분리하는 정책
- preset, 검색, 필수축 필터, 조건부 축 UX

정확히 이식하지 않는 명시적 예외:

- `doubao-seedance-2-5-260628` 모델 문자열
- provider endpoint/auth/transport URL 형식
- 2.5 모델별 공식 지원이 확인되지 않은 `seed`, `camera_fixed`, legacy CLI flag
- 현재 `textGeneration: none`보다 완화된 모든 텍스트 생성 옵션
- 정책상 허용하지 않는 배경 글자·로고·전화 UI 생성 옵션

### 3.3 어댑터로 변환

- `HiggsfieldSeedanceRequest` → `SeedanceGenerationSpec` 공급자 중립 타입
- Higgsfield `mode/aspect_ratio` → BytePlus `content/ratio` 공식 request
- `higgsfieldAssets` → `generatedAssets` provider-neutral registry
- Higgsfield claim → provider-neutral generation claim
- 외부 생성 URL → 영구 `GeneratedAssetStore` URL
- 원본 localStorage preset → 프로젝트에 버전이 포함된 preset
- 참조 자산 URL → `assetId + sha256` 승인 정체성과 제출 시점 transport URL의 분리
- 브라우저 `remoteUrl` → preview용 signed/range URL과 Remotion 내부 asset resolver의 분리

### 3.4 제거하거나 legacy로 격리

- UI와 schema에 각각 중복 선언된 축 옵션
- Higgsfield CLI를 기본 생성 경로로 호출하는 route
- provider 응답을 `unknown`으로 저장하는 방식
- 컴포넌트 로컬 state에만 작업 결과를 저장하는 방식
- 랜덤 ID로 asset/ledger/timeline을 각각 갱신하는 수동 import
- `concat*.txt`, 개별 Python concat을 핵심 운영 경로로 사용하는 방식
- 생성 원본에 정확한 문자·앱 UI를 맡기는 방식

Higgsfield 코드는 즉시 삭제하지 않고 `legacy-higgsfield` adapter로 한 릴리스 동안 격리한 뒤, BytePlus 실사용 검증 후 제거한다.

## 4. 목표 아키텍처

### 4.1 Domain 계층

신규 파일 제안:

```text
app/lib/seedance/catalog.ts
app/lib/seedance/schema.ts
app/lib/seedance/compiler.ts
app/lib/seedance/constraints.ts
app/lib/seedance/compiler.golden.test.ts
```

책임:

- `catalog.ts`: 원본 AXES의 단일 정본. UI와 compiler가 함께 읽는다.
- `schema.ts`: 28축과 API 파라미터를 Zod로 검증하고 `schemaVersion`을 가진다.
- `constraints.ts`: requires, task lock, duration/ratio/audio 정책을 순수 함수로 판정한다.
- `GenerationBlueprint`: Storyboard + 생성 전 Production 입력에서 `takes`·output asset·timeline을 제외한 immutable generation input + 28축을 정규화한다.
- `compiler.ts`: `GenerationBlueprint` → provider-neutral `SeedanceGenerationSpec`을 만든다.
- `generationInputHash`: 현재 `computeProductionHash()`처럼 mutable `production.takes`를 포함하지 않는다. Take 추가는 GenerationAuthorization을 깨지 않고 ReleaseApproval만 무효화한다.
- golden test: 원본 HTML의 대표 설정과 프롬프트 판단이 React 포팅 결과와 의미상 동일함을 보장한다. provider 모델·endpoint·무문자 강제·공식 2.5 제한은 의도된 divergence allowlist로 별도 검증한다.

원본 HTML은 변경하지 않은 증거물로 다음 경로에 체크인한다.

```text
docs/reference/seedance-master-builder-v2.html
docs/reference/seedance-master-builder-v2.sha256
```

런타임은 HTML을 실행하지 않는다. 원본 JS를 서버에서 eval하거나 iframe으로 로드하지 않는다.

### 4.2 Provider 계층

```text
app/lib/generation/provider.ts
app/lib/generation/types.ts
app/lib/generation/job-repository.server.ts
app/lib/generation/submission-guard.server.ts
app/lib/generation/byteplus/schema.ts
app/lib/generation/byteplus/map-request.ts
app/lib/generation/byteplus/client.server.ts
```

공통 계약:

```ts
type GenerationProvider = {
  capabilities: { cancel: boolean };
  submit(spec: SeedanceGenerationSpec): Promise<GenerationJobReceipt>;
  get(jobId: string): Promise<GenerationJobStatus>;
  cancel?(jobId: string): Promise<GenerationJobStatus>;
};
```

BytePlus 고정값:

```text
Base URL: https://ark.ap-southeast.bytepluses.com
Create:   POST /api/v3/contents/generations/tasks
Retrieve: GET  /api/v3/contents/generations/tasks/{task_id}
Model:    dreamina-seedance-2-5-260628
Auth:     Authorization: Bearer BYTEPL..._KEY
```

공식 고정 출처:

- Seedance 2.5 tutorial 및 모델별 reference/portrait 제한: <https://docs.byteplus.com/en/docs/ModelArk/2607688>
- Create content generation task: <https://docs.byteplus.com/en/docs/ModelArk/1520757>
- Retrieve task, 24시간 URL·100회 다운로드·7일 조회 제한: <https://docs.byteplus.com/en/docs/ModelArk/1521309>

일반 content API의 최대 배열 크기와 Seedance 2.5 모델별 허용 개수를 섞지 않는다. adapter 제약은 모델별 tutorial을 우선하고 일반 API 제한은 상한 방어로만 사용한다.

원칙:

- API key는 server-only이며 GitHub source, 브라우저 response, 로그에 포함하지 않는다.
- 공식 request/response를 Zod로 strict parsing한다.
- provider 오류는 내부 raw body를 숨기고 안정된 오류 코드로 변환한다.
- 서버가 승인된 `GenerationBlueprint`에서 provider request를 먼저 컴파일한다.
- `GenerationAuthorization` payload는 `approvalVersion + projectId + attemptId + provider + model + providerApiVersion + compilerVersion + policyVersion + canonical requestHash + approvedAt + approvedBy`를 서명한다.
- 제출 시 현재 request를 다시 컴파일해 signed `requestHash`와 다르면 claim 생성 전 403으로 거부한다.
- `requestKey = sha256(projectId + attemptId + requestHash)`이며 approval timestamp/HMAC 문자열을 idempotency identity로 사용하지 않는다.
- 같은 attempt의 재승인은 같은 requestKey를 유지한다. 새 과금은 사용자가 명시적으로 “새 유료 생성 시도”를 승인해 새 attemptId를 만들 때만 가능하고 `uncertain`이 남아 있으면 금지한다.
- 요청 reference는 승인된 `assetId + sha256`와 일치해야 하며, signed transport URL 자체는 승인 hash에서 제외한다.
- timeout/connection loss 시 `uncertain`으로 잠그고 자동 재제출하지 않는다.
- BytePlus가 provider idempotency header를 공식 지원한다고 확인되기 전까지 내부 claim을 유일한 중복 방지로 사용한다.
- 공식 create 응답은 task ID만 반환할 수 있으므로 제출 직후 Job Repository 기록 성공까지를 하나의 fail-closed 제출 절차로 본다.
- cancel/delete는 BytePlus 공식 endpoint와 과금·상태 semantics를 계정에서 검증한 뒤 capability로 연다. 명시적 사용자 동작만 허용하며 과금 claim을 해제하거나 같은 요청의 재제출 권한을 만들지 않는다.

### 4.3 Job 계층

Workflow에 다음 provider-neutral 상태를 추가한다.

```ts
type GenerationJobBase = {
  projectId: string;
  attemptId: string;
  requestKey: string;
  requestHash: string;
  provider: 'byteplus' | 'higgsfield-legacy';
  model: string;
  generationAuthorizationId: string;
  createdAt: string;
  updatedAt: string;
  nextPollAt?: string;
  pollAttempts: number;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  lastErrorStage?: string;
  errorCode?: string;
};

type GenerationJob =
  | (GenerationJobBase & {
      status: 'claimed' | 'submitting' | 'uncertain';
      providerJobId?: string;
    })
  | (GenerationJobBase & {
      status: 'submitted' | 'running' | 'provider_succeeded' | 'ingesting' | 'ingest_failed' |
        'failed' | 'expired' | 'cancel_requested' | 'cancelled';
      providerJobId: string;
    })
  | (GenerationJobBase & {
      status: 'ready';
      providerJobId: string;
      outputAssetId: string;
    });
```

`uncertain`에 providerJobId가 없으면 자동 `get()`을 할 수 있다고 주장하지 않는다. BytePlus에 authoritative receipt lookup이 공식 확인되지 않는 한 과금 lock을 유지하고 `/recover`는 fail-closed 409로 비활성화한다. `ready`는 결과 bytes, checksum, rich metadata, decode smoke가 영구 저장된 뒤에만 기록한다.

API:

```text
POST /api/projects/:projectId/generations
GET  /api/projects/:projectId/generations
GET  /api/projects/:projectId/generations/:requestKey
POST /api/projects/:projectId/generations/:requestKey/recover
GET  /api/projects/:projectId/generated-assets/:assetId
```

모든 route는 기존 agent/owner 인증에 더해 서버 저장 `projectId`와 project-scoped signed capability를 대조한다. requestKey와 assetId 자체를 bearer secret으로 취급하지 않는다. Next App Router dynamic params는 Next 16 async params 규칙을 사용하고 filesystem/crypto/child-process/ffprobe route는 `runtime = 'nodejs'`와 명시적 `maxDuration`을 둔다.

브라우저 새로고침 후 서버의 project-scoped job listing으로 상태를 복구한다. 임의의 provider job ID를 클라이언트가 직접 조회하게 하지 않는다. 서버 Job Repository가 정본이고 `workflow.generationJobs`는 projection이다.

저장소는 인터페이스로 분리한다.

- 1차: 단일 Windows self-hosted 서버용 원자적 filesystem repository + 장기 실행 generation worker
- 배포 확장 전: Supabase/Postgres 또는 다른 공유 durable store adapter + lease 기반 worker
- Vercel/다중 인스턴스에서 host-local claim·request 내부 background timer 사용 금지
- `GET` status는 read-only다. provider poll/ingest는 `nextPollAt`, `leaseOwner`, `leaseExpiresAt`을 사용하는 worker가 수행하고, 시작 시 만료 lease와 temp object를 재조정한다.
- `/recover`는 authoritative provider receipt lookup이 구현될 때까지 409로 비활성화하며 submit이나 caller-supplied provider job ID 결합을 허용하지 않는다.
- 화면 polling은 서버 정본을 보여주는 projection 동기화일 뿐 결과 URL 회수 책임이 아니다.
- durable repository에서 active job 수·principal별 비용/요청 한도를 원자적으로 검사한다. process-local queue만으로 과금 job 수를 제한했다고 간주하지 않는다.
- BytePlus 조회 제한(최근 7일), 결과 URL 24시간, 2.5 결과 다운로드 최대 100회를 운영 제약으로 저장한다. URL 만료 전에 영구 회수가 끝나지 않으면 자동 재생성하지 않고 복구 오류로 잠근다.

### 4.4 결과 회수·영구 자산 계층

```text
app/lib/generated-assets/ingest.server.ts
app/lib/generated-assets/store.server.ts
app/lib/generated-assets/schema.ts
```

완료 처리:

1. provider status가 성공인지 strict 확인
2. 공식 결과 URL은 24시간·100회 다운로드 제한이며 작업 조회는 최근 7일만 보장되므로 성공 확인 즉시 1회 서버 회수를 시작
3. output URL allowlist + HTTPS + DNS pinning
4. redirect마다 재검증하고 40초 network timeout·총 작업 timeout 적용
5. Content-Length 사전 cap과 streaming byte cap을 모두 적용해 임시 파일로 다운로드하고 download attempt를 기록
6. MIME + magic byte 확인
7. 확장 `ffprobe`: 실제 video/audio/subtitle/data/attachment stream, duration, width/height, frame rate, codec 확인; probe timeout/output cap 적용
8. 요청값과 실제값의 허용 오차, stream 수·해상도·fps 상한·허용 codec을 검증하고 실제 duration/fps를 자산 metadata로 채택
9. 짧은 Chrome/ffmpeg decode smoke로 Remotion 재생 가능성 확인
10. SHA-256 계산
11. 영구 저장소로 원자적 승격
12. `GeneratedAsset`과 `qc_pending` 후보 Take 기록
13. provider 임시 URL 대신 ClipJS 소유 asset ID만 프로젝트 정본에 저장
14. OCR/로고/인물·손/오디오 정책의 사람 검수를 통과하면 `take_approved`
15. 승인된 Take만 durable import transaction으로 타임라인에 삽입

초기 Windows 배포는 다음처럼 저장할 수 있다.

```text
%USERPROFILE%\.clipjs\generated-assets\<assetId>.mp4
```

Vercel 배포 시에는 `GeneratedAssetStore` adapter를 R2/S3/Supabase Storage로 교체한다. Windows local store 단계에서는 다음 두 해석 경로를 분리한다.

- 브라우저 preview: project/asset에 묶인 단기 signed capability, HTTP Range/HEAD/206, Content-Length, ETag를 지원하는 asset route; capability URL은 프로젝트에 저장하지 않음
- Remotion render: server-owned asset ID를 검증된 local path로 직접 resolve하여 bundle staging하고 staging 후 checksum을 재확인; 자신의 localhost URL을 remote downloader에 다시 통과시키지 않음
- Store policy: per-asset cap, project/principal quota, 전체 cap, 최소 free disk threshold를 두고 threshold 미만이면 새 submit/ingest를 fail-closed
- Metadata: `createdAt`, `lastReferencedAt`, `projectId`, `jobId`, `contentSha256`, `byteSize`, `storageKey`
- Startup/periodic reconciliation: job 없는 bytes, bytes 없는 metadata, stale temp, orphan object를 정리하되 idempotency claim/job receipt는 GC하지 않음
- 삭제는 project reference 확인과 명시적 retention policy를 거치며, R2/S3/Supabase adapter에도 동일 quota/retention/lifecycle monitoring을 적용

### 4.5 Take Ledger·타임라인 영속적 삽입

현재 asset registry, Take Ledger, `mediaFiles`가 별도 dispatch라 중복·부분 저장 가능성이 있다. Redux reducer와 IndexedDB transaction을 구분한다.

```ts
prepareRecoveredGenerationImport({job, asset, placement})
commitRecoveredGenerationImport({transactionId})
```

ID 계약:

- `GeneratedAsset.id`: 영구 binary/provenance 정체성; `provider + providerJobId`와 `contentSha256`에 UNIQUE
- `GenerationTake.outputAssetId`: 위 `GeneratedAsset.id`를 참조
- `MediaFile.id`: 타임라인 placement 정체성; asset ID와 다른 deterministic ID
- `MediaFile.source`를 `{kind:'indexeddb'; fileId}` 또는 `{kind:'generated'; generatedAssetId}` discriminated union으로 정의하고 legacy `fileId` 필드는 migration boundary에서만 읽음
- `MediaFile.generatedAssetId`: 원본 자산 참조
- `MediaFile.fileId`: IndexedDB Blob만 가리키며 server-owned generated asset에는 사용하지 않음

영속화는 새 `ProjectSaveCoordinator` command/thunk가 담당한다.

1. 서버에서 `take_approved`와 asset ownership을 재검증한다.
2. project별 monotonic revision과 Web Locks/CAS로 다중 탭 경쟁을 차단한다.
3. deterministic next project와 file metadata를 IndexedDB 하나의 transaction으로 `saveNow()`하고 commit ack를 기다린다.
4. transaction commit 이후에만 Redux projection, saved revision, 성공 toast를 갱신한다.
5. 실패 시 server job/asset receipt는 유지하고 `saveError`와 재시도 가능한 동일 transaction ID를 표시한다.
6. dirty revision이 있는 navigation은 경고하며 `pagehide` flush를 성공 보장으로 간주하지 않는다.

동시에 보장할 내용:

- `generatedAssets[assetId]` upsert
- Take Ledger를 `provider + providerJobId`/`outputAssetId` 기준 upsert
- `mediaFiles`에 deterministic id로 한 번만 삽입
- project duration을 요청 30초가 아니라 ffprobe 실제 duration으로 갱신
- 24fps 원본을 30fps 프로젝트에 배치할 때 시간 단위 trim을 유지하고 프레임 변환을 명시적으로 검증
- workflow approval 정책에 따라 후편집 변경 상태 표시

재시도·더블클릭·다중 탭에서도 같은 `outputAssetId`가 두 번 들어가지 않아야 한다. autosave queue가 오류를 삼키는 현재 동작은 실제 제출 기능을 열기 전에 먼저 수정한다.

### 4.6 후편집 Recipe 계층

```text
app/lib/post-production/schema.ts
app/lib/post-production/recipe.ts
app/lib/post-production/apply.ts
```

`PostProductionRecipe`가 다음을 명시한다.

- 생성 영상 placement
- 정확한 앱 UI overlay와 안전 영역
- 한국어 내레이션/상담사 대사
- Seedance 원음 유지·감쇄·제거 정책
- BGM/SFX cue와 볼륨
- 자막·엔딩 카드·브랜드
- Noto Sans KR 스타일과 safe area

오디오 정책:

- `generateAudio=true`는 source audio를 쓸 의도가 있을 때만 선택하며, 이것만으로 최종본 오디오가 완성됐다고 보지 않는다.
- 정확한 한국어 대사가 필요한 컷은 Seedance에 이해 가능한 발화를 맡기지 않는다. `generateAudio=false`로 후더빙하거나, `true`인 경우 무의미한 ambience만 허용하고 speech leakage QC를 통과해야 한다.
- Seedance 음성과 TTS를 그대로 겹치지 않는다. source audio의 유지·감쇄·제거를 Recipe에 명시한다.
- `audioLanes`에 dialogue/SFX/music이 선언되면 대응되는 실제 후편집 asset/cue가 없을 때 release approval과 render를 거부한다.
- 최종 render 전에 의도된 audio stream 또는 사용자 signed intentional-silence 선언 중 하나를 반드시 요구한다.

UI 정책:

- 생성 원본은 무문자 정책을 계속 강제한다.
- 휴대전화 화면은 지정된 단색 합성 평면으로 생성한다.
- 1차는 Production에 정의한 정적/키프레임 overlay transform을 적용한다.
- 자동 marker tracking은 별도 단계로 두며, 추적 품질 검증 전에는 자동 승인하지 않는다.

## 5. 원본과 GitHub 포팅의 구체적 차이

현재 React/Zod 포팅에는 28축 schema와 UI가 대체로 존재한다. 그러나 다음 원본 기능은 canonical한 형태로 통합되지 않았다.

- AXES option/value/requires가 schema/UI/compiler에 분산되어 중복됨
- 원본의 검색·필수축 필터·선택 요약·preset 관리가 없음
- `output_format`, `watermark`, `return_last_frame`이 workflow 설정에 없음
- 작업 유형별 ratio/duration 잠금 UX가 원본보다 약함
- provider 타입과 model ID가 Higgsfield 중심임
- 원본의 공식 API body 예시와 현재 Higgsfield request field가 직접 일치하지 않음
- 프롬프트 golden parity가 없어 원본 수정과 React 포팅이 쉽게 어긋날 수 있음
- 원본 HTML model은 `doubao-*`인데 BytePlus 공식 model은 `dreamina-*`라 provider parameter를 그대로 복사하면 실패함
- `GenerationTake.mode`가 first-frame/first-last-frame을 표현하지 못하고, `activeReferences.role`이 last-frame/reference-audio/reference-video를 표현하지 못함
- Production reference는 총 `max(50)`만 검증하지만 Seedance 2.5 multimodal reference-to-video의 모델별 제한은 이미지 0–30·영상 0–10·오디오 0–10(총 50)이며 pure-audio reference도 지원됨
- Seedance 2.5는 실제 사람 얼굴이 든 reference 이미지/영상의 직접 업로드를 지원하지 않으므로 기존 캐릭터 Reference Pack 경로를 그대로 열 수 없음
- Production shot duration은 최대 120초를 허용하지만 Seedance 2.5 generation spec은 최대 30초이므로 cross-schema preflight가 필요함
- Production의 `assetUrl`은 browser blob/만료 URL일 수 있어 BytePlus가 가져갈 수 없고, 승인 hash가 URL 회전에 흔들릴 수 있음
- 현재 `provider` union은 `local | higgsfield`라 `byteplus` migration이 필요함
- 현재 ffprobe 검증은 stream type만 보며 duration/해상도/fps/codec을 검증하지 않음
- 현재 autosave queue는 영속화 오류를 UI에 성공/실패로 전달하지 못함
- 현재 render approval은 생성 승인과 별개인 최종 timeline/text/audio/export 상태를 서명하지 않음
- local generated asset을 same-origin URL로 만들면 현재 remote staging SSRF loopback 차단과 충돌함

따라서 원본 HTML의 UI를 복사하는 것이 아니라, 원본의 데이터와 pure decision logic을 먼저 공용 모듈로 옮기고 React UI를 그 모듈에서 자동 렌더해야 한다. 위 schema와 persistence 충돌을 해결하기 전에는 유료 submit route를 열지 않는다.

## 6. 단계별 PR 계획

### Gate 0 — 구현 전 영속성·배포 전제

코드 통합 전에 다음을 통과한다.

- MIT `LICENSE`와 원본 copyright 고지를 배포물에 보존
- `storeProject` autosave 오류가 호출자/UI까지 전달되는 회귀 테스트
- IndexedDB transaction/commit ack 설계 확정
- Windows local store 외의 Vercel 배포에서는 shared Job Repository와 object storage가 없으면 generation 기능 비활성화

### PR A — 원본 정본화와 parity

목표: 유료 API 변경 없이 원본 빌더와 ClipJS 판단 결과를 일치시킨다.

변경:

- 원본 HTML과 SHA 체크인
- canonical catalog/schema/constraints/compiler 생성
- 기존 `seedance-master.ts`를 새 compiler facade로 축소
- React panel을 catalog-driven UI로 변경
- preset/search/requires UX 이식
- workflow schema migration 추가
- approval state를 creative/generation/release로 분리하고 legacy approval 무효화·변경별 invalidation matrix 테스트
- `GenerationTake.mode`, reference role, per-media reference limit, 30초 cross-schema constraint 정합화
- asset approval identity를 URL이 아닌 SHA-256 기반으로 확장

검증:

- 28축 id·option·requires 완전 일치
- 공식 5종 prompt golden fixture + 의도된 provider/policy divergence fixture
- 20초/30초 timestamp fixture
- R2V 축 잠금 및 무문자 고정
- Seedance 2.5 reference-to-video의 이미지 0–30·영상 0–10·오디오 0–10(총 50), pure-audio 지원, task별 reference preflight
- 실제 사람 얼굴 reference는 feature flag로 닫고 BytePlus 공식 portrait solution과 consent 경로를 별도 검증
- 120초 Production shot이 2.5 generation으로 내려갈 때 fail-closed
- 기존 110개 테스트 회귀 없음
- 실제 브라우저에서 필수축·검색·preset·잠금 검증

### PR B — 부작용 없는 영속성 foundation

목표: provider 호출 없이 유료 작업과 결과 자산이 살아남을 저장·동시성 기반을 먼저 만든다.

변경:

- `projectSchemaVersion: 3` migration ingress와 backup/rollback
- `ProjectSaveCoordinator`, revision/CAS, Web Locks, visible save error/retry
- 동일 transaction repository의 `SubmissionClaim + GenerationJob`, UNIQUE `requestKey`
- worker lease/`nextPollAt`/attempt/error-stage 필드와 startup reconciliation 기반
- `GeneratedAssetStore` interface, quota/retention/orphan metadata
- project-scoped 인증이 적용된 read-only status/list API
- `BYTEPLUS_SUBMISSION_ENABLED` 기본값 false; 실제 submit 경로는 `503 FEATURE_NOT_READY`

검증:

- 두 repository/process 경쟁에서 같은 requestKey claim 1개
- claim/job transaction 실패 시 provider 호출 0회
- v1/v2/import/IndexedDB/agent/render ingress가 모두 동일 v3 migration 사용
- autosave/IndexedDB quota/error, import 직후 refresh/navigation, write 중 browser/process 종료를 주입해 거짓 성공·데이터 유실 0
- 두 탭 경쟁에서 lost update 0; dirty revision navigation 경고와 명시적 retry 확인
- feature flag가 false이면 API key 존재 여부와 무관하게 provider 호출 0회

### PR C — 공급자 중립화와 BytePlus compile-only adapter

목표: Higgsfield 이름을 domain에서 제거하고, 공식 BytePlus request를 만들고 승인할 수 있게 하되 네트워크 submit은 하지 않는다.

변경:

- provider-neutral spec/job/result 타입
- BytePlus strict schema/client interface/mapper
- `GenerationBlueprint` → canonical provider request compiler
- GenerationAuthorization preview/sign API와 request hash/versioning
- compile-only/dry-run route와 fake provider fixture
- `.env.example`에 `BYTEPLUS_ARK_API_KEY` 이름만 추가
- 공식 모델 ID가 `dreamina-*`이고 원본 `doubao-*`가 request에 들어가지 않는 테스트

검증:

- 공식 문서 request fixture와 body 일치
- API key 누락 시 fail-closed
- key/prompt/raw provider error가 응답·로그에 노출되지 않음
- 모든 provider-request semantic field mutation이 GenerationAuthorization을 무효화
- 승인 timestamp/HMAC 변경만으로 새 requestKey가 생기지 않음
- 실제 BytePlus network call 0회

### PR D — 전체 generation·worker·ingest·Take import 수직 슬라이스

목표: `queue admission → claim+job 원자 생성 → provider submit → submitted/uncertain 저장 → lease worker polling → secure ingest → ready → Take 검수 → durable project import` 전체를 fake provider로 완성한다. BytePlus 실사용 feature flag는 계속 꺼 둔다.

변경:

- project-scoped submit/status/recover route와 GenerationAuthorization 재검증
- durable active-job/spend/rate admission 후 claim+job 원자 생성
- submit response/timeout을 `submitted` 또는 `uncertain`으로 영속화
- lease 기반 poll/ingest worker, startup lease/temp reconciliation, read-only GET projection
- secure ingest, GeneratedAssetStore, rich media probe/hash/decode smoke
- preview Range route와 Remotion internal asset resolver
- provider 임시 URL의 asset ID 치환
- 후보 Take QC 상태와 승인 동작
- `ProjectSaveCoordinator` durable import + Redux projection commit
- Take Ledger와 timeline deterministic upsert

검증:

- claimed → submitting → submitted → running → provider_succeeded → ingesting → ready
- failed/cancelled/expired/ingest_failed/invalid response
- 동일 요청 동시 경쟁에서 submit 1회; response loss는 uncertain·자동 재시도 0회
- 두 worker 경쟁에서도 lease 획득·provider poll·ingest 각각 1회
- worker crash와 lease 만료 후 다음 worker가 동일 job을 재개하고 submit은 0회
- refresh/restart recovery와 server-authoritative projection 재동기화
- GET route는 provider poll/ingest를 수행하지 않음
- 임의 job ID 조회·다른 프로젝트 receipt/capability 접근 거부
- SSRF/private IP/DNS rebind/redirect loop 차단
- oversized/HTML/가짜 MP4/31번째 이미지·11번째 영상·11번째 오디오/정책 밖 stream/codec 거부
- actual duration/resolution/fps/codec/audio metadata와 decode smoke 검증
- 검증/timeout 실패 시 temp bytes 삭제, `lastErrorStage`와 `ingest_failed` 기록, 같은 provider result의 idempotent 재수집 가능
- `contentSha256`은 모든 ready asset의 필수 metadata
- 같은 결과 10회 recover해도 GeneratedAsset/Take 각 1개, 승인 전 MediaFile 0개
- QC 승인 후 같은 import 10회에도 `MediaFile.id` 1개, `generatedAssetId` 참조 일치
- 동일 content SHA-256의 다른 placement는 각 MediaFile ID를 갖되 binary는 정책에 따라 dedupe
- IndexedDB transaction 실패 시 성공 표시·Redux projection 갱신 금지
- 두 탭 동시 import에서 Web Locks/CAS로 lost update·중복 placement 0
- preview seek Range/HEAD 재생, capability 만료·cross-project 접근 거부, Remotion local asset resolve 성공
- 24fps 720p source의 30fps 1080p 프로젝트 배치·렌더 성공

### PR E — 오디오·UI·자막 후편집 Recipe

목표: 무음 원본이 그대로 최종본이 되는 문제를 차단한다.

변경:

- post-production schema/apply
- dialogue/TTS, ambience, SFX, BGM cue
- app UI overlay, caption, ending card preset
- audio policy preflight
- 최종 media/asset checksum/timeline trim-crop-volume/text/caption/effect/transition/audio/UI/export/post-production hash를 묶는 signed ReleaseApproval
- Release preview API, owner-only sign API, 승인 UI
- `/api/render`에서 현재 renderInputHash 재계산·ReleaseApproval 서명 검증

검증:

- 무음 최종본은 명시적 승인 없이는 렌더 거부
- asset/timeline/trim/crop/volume/text/caption/effect/transition/audio/UI/resolution/fps/export 각 semantic field mutation이 ReleaseApproval을 무효화
- creative/generation approval만으로 `/api/render` 직접 호출 시 403
- 한국어 대사와 자막 cue 일치
- 생성 화면에는 문자 없음, 최종본에는 정확한 후편집 문자만 존재
- 1920×1080과 1280×720 모두 safe-area 유지
- H.264/AAC 최종 MP4 ffprobe 통과

### PR F — 완전 E2E·런타임 교정·운영 전환

목표: mock으로 전체 파이프라인과 장애 복구를 통과한 뒤, 별도 사용자 승인 1회의 canary에만 BytePlus 실사용 flag를 열고 성공 후 기본 provider를 전환한다.

변경/검증:

- Docker/runtime을 Next 16 요구에 맞는 Node 22 계열로 고정하고 Windows·Linux 빌드 확인
- durable `RenderJob`과 전용 render worker를 구현하고 `POST /api/render`는 202 + job receipt 반환
- timeout/cancel 시 Windows Job Object 또는 동등한 tree-kill로 Chrome/ffmpeg 전체 process tree를 graceful→force 순으로 종료하고 실제 `close/exit`를 await한 뒤 lease 해제
- stale render lease·temp file은 worker 시작 시 reconciliation
- route/gateway deadline은 `queue wait + staging + browser start + composition + render + forced-kill grace + cleanup` 최악값보다 최소 30초 크게 설정
- 초기 Windows 배포는 submit worker 1개·render worker 1개만 허용; Vercel/multi-replica는 shared lease/queue와 외부 render worker 전까지 generation/ingest/render 비활성
- mocked provider 브라우저 E2E: GenerationAuthorization→제출→worker 복구→Take 승인→영속 import→ReleaseApproval→렌더
- crash matrix: claim 직후, provider 응답 직후, poll 중, download 중, rename 전후, IndexedDB commit 전후, render timeout
- 승인된 1회의 실제 소액 BytePlus smoke; 과금 내역과 provider job ID 대조
- 실사용 feature flag가 꺼진 상태에서 API key가 있어도 provider 호출 0회
- 서버 재시작 후 completed 결과 재사용
- `npm test`, type-check, ESLint error 0, build, `git diff --check`
- 독립 P0/P1 리뷰와 canary 통과 후 default provider 전환; Higgsfield는 legacy fallback으로 제한

## 7. 수직 슬라이스 우선순위

첫 번째 완성 슬라이스는 기능을 넓게 펼치지 않고 다음 하나만 끝까지 연결한다.

```text
30초 t2v · 16:9 · 720p · 참조 없음
→ source audio 정책 선택: ambience-only면 generate_audio=true, 정확한 대사 중심이면 false
→ GenerationAuthorization 승인
→ BytePlus 1회 제출
→ 상태 조회·결과 영구 회수
→ `qc_pending` 후보 Take 등록
→ 무문자·인물·speech leakage 검수 및 Take 승인
→ durable transaction으로 타임라인 0초에 1회 삽입
→ 정확한 한국어 후더빙/효과음/BGM/엔딩 카드
→ ReleaseApproval
→ Remotion MP4 렌더
```

이 슬라이스가 통과한 뒤 reference/image, edit, extension, first-frame, first/last-frame을 순서대로 연다. Seedance 2.5 reference-to-video는 이미지 0–30·영상 0–10·오디오 0–10(총 50), pure-audio 지원과 task별 조합을 각각 검증한다. 실제 사람 얼굴 reference는 공식 portrait solution·consent 경로가 검증되기 전 feature flag로 닫는다. 한 번에 공식 5종 전체를 유료 E2E하지 않는다.

## 8. 데이터 마이그레이션

- exported project root에 `projectSchemaVersion: 3` 추가; IndexedDB schema version은 별도로 관리
- raw JSON을 current Zod schema로 바로 parse하지 않고 모든 IndexedDB load/import/agent/render ingress에서 `unknown → versioned migrate → strict validate` 순서 사용
- 기존 Higgsfield/외부 URL 자산은 rename만 하지 않고 `external-unmanaged`로 표시; 안전한 ingest·hash·영구 store 승격 전에는 managed GeneratedAsset이나 render-ready로 간주하지 않음
- migration 전 snapshot/backup을 만들고 중간 실패 시 기존 저장본을 덮어쓰지 않음
- `workflow.seedanceMaster.schemaVersion` 추가
- 기존 28축 값을 canonical key로 변환
- legacy `textGeneration`은 항상 `none`
- `workflow.higgsfieldAssets`를 `generatedAssets`로 additive 변환하되 원본 provider/jobId를 보존하고 한 릴리스 동안 legacy read를 지원
- `MediaFile.provider`에 `byteplus`를 추가하되 기존 `local`/`higgsfield` 프로젝트를 그대로 읽음
- `GenerationTake.mode`와 reference role을 공식 5종에 맞게 확장
- 참조 자산에 immutable `sha256`, bytes, MIME을 추가하고 만료 `assetUrl`은 transport metadata로 분리
- legacy Take의 `outputAssetId`가 없으면 provider/job provenance나 content SHA-256으로 유일하게 대응될 때만 backfill; 증명이 없으면 `unresolvedLegacyAsset`로 표시하고 자동 추측 금지
- migration 후 기존 generation approval과 release approval은 무효화하고 사용자 재승인 요구
- 기존 `D:\비디오자동화` 외부 MP4/MP3는 import manifest를 통해 1회 Asset Registry/Take Ledger에 등록

## 9. 보안·비용 위협 모델

| 위험 | 통제 |
|---|---|
| API key 유출 | server-only env/secret store, response·log redaction |
| 중복 과금 | approval-bound canonical request key, atomic claim, uncertain lock |
| 임의 작업 탈취 | provider job ID 대신 project requestKey로 조회, resource authorization |
| 악성 결과 URL | HTTPS, host allowlist, DNS pinning, redirect 재검증, private/reserved IP 차단 |
| 거대 파일/DoS | body·download byte cap, queue cap, timeout, cleanup |
| 가짜 MP4 | MIME, magic byte, ffprobe stream 검증 |
| 임시 URL 만료 | 성공 즉시 영구 저장소로 복사 |
| 부분 삽입 | `ProjectSaveCoordinator`가 IndexedDB commit ack 후 Redux projection 갱신; Web Locks/CAS로 다중 탭 직렬화 |
| 생성 결과가 production hash를 바꿔 승인 파손 | mutable takes/output/timeline을 제외한 `GenerationBlueprint` hash 사용 |
| ID 혼용 | GeneratedAsset·Take 참조·Media placement·IndexedDB file ID를 별도 필드/UNIQUE로 분리 |
| 검수 전 자동 채택 | 결과를 `qc_pending` 후보로만 등록, signed Take approval 전 timeline 삽입 금지 |
| 만료 reference URL로 승인 흔들림 | 승인 정체성은 asset SHA-256, transport URL은 제출 직전 생성 |
| 사람 얼굴 reference 정책 위반 | portrait reference 기능 기본 비활성; 공식 solution·consent·계정 지원 검증 후 개방 |
| same-origin asset와 SSRF 충돌 | preview Range route와 Remotion internal resolver 분리 |
| 최종 편집 무단 변경 | signed ReleaseApproval hash를 `/api/render`에서 재검증 |
| 다중 인스턴스 재제출 | shared Job Repository + lease worker 전에는 단일 self-host 배포만 허용 |
| 저장소 고갈 | project/principal quota, 전체 cap, free-disk threshold, orphan reconciliation |
| Node/runtime 불일치 | Docker와 CI를 Node 22 계열로 고정하고 Next 16 build/E2E |
| GitHub Actions 과금 호출 | CI는 mocked provider만 사용; 실제 생성 job 금지 |
| MIT 고지 누락 | upstream `LICENSE`와 copyright를 배포물에 포함 |

## 10. 승인 게이트

다음 네 승인 수준을 분리한다.

1. **Creative approval**: 콘티가 참신하고 브랜드 목표에 맞는가
2. **GenerationAuthorization**: 정확한 `GenerationBlueprint`—Storyboard + 생성 전 Production inputs/asset hashes에서 mutable takes·output asset·timeline을 제외한 값 + 28축 + provider/model/providerApiVersion/compilerVersion/policyVersion + attemptId + canonical BytePlus request hash—에 대한 owner-signed 유료 1회 승인
3. **Take approval**: 영구 회수된 결과의 기술 검증, 무문자·로고·인물·오디오·연속성 검수 승인
4. **ReleaseApproval**: media/timeline/text/caption/effect/audio/UI/export/post-production hash와 법적 카피를 묶은 owner-signed 최종본 승인

현재 `StoryboardApproval`/HMAC은 다음 상태 머신으로 교체한다.

- `workflow.approval` → `creativeApproval`, `generationApproval`, `releaseApproval`; Take approval은 각 `GenerationTake`에 귀속
- legacy 단일 approval은 v3 migration에서 모두 `invalidated`
- Creative 입력 변경 → Creative/Generation/Release 모두 무효화
- provider 생성 입력·asset hash·28축·compiler/provider version 변경 → Generation/Release 무효화
- Take·asset selection·timeline·trim/crop/volume·text/caption/effect/transition·audio/UI/export 변경 → Release만 무효화
- `releaseApproval.renderInputHash`는 `assetId + contentSha256`, 전체 timeline/trim/crop/volume, text, captions, effects, transitions, audio recipe, UI, resolution/fps/format/export settings를 포함
- PR E에 Release preview API, owner sign API, 승인 UI를 추가
- `/api/render`는 현재 render input을 서버에서 다시 canonicalize/hash하고 유효한 ReleaseApproval과 다르면 403; Creative/Generation approval만으로 렌더 금지

콘티가 재미없다는 이전 문제는 28축 자동화만으로 해결되지 않는다. 사용자 주제와 핵심 콘셉트를 받은 뒤 2~3개 treatment를 비교하고 Creative approval을 통과한 콘티만 유료 generation으로 보낸다.

## 11. 완료 정의

통합 완료라고 말할 수 있는 기준:

- 원본 28축 prompt golden parity와 의도된 divergence fixture 통과
- `BYTEPLUS_ARK_API_KEY`는 서버에만 존재
- 공식 모델 `dreamina-*`만 BytePlus adapter에 들어가고 원본 `doubao-*`는 전송되지 않음
- 승인된 동일 요청은 provider 제출 최대 1회
- 서버 Job Repository 정본으로 새로고침/재시작 후 job 복구
- 성공 결과 자동 다운로드·hash·확장 ffprobe 검증
- 결과 QC 전 timeline 삽입 0, Take 승인 후 반복 import에도 중복 0
- generated asset preview Range와 Remotion internal resolve 모두 성공
- 생성 원본 문자 0을 사람 검수하고 최종본 정확한 UI/자막 적용
- 최종 MP4에 의도된 오디오 stream 존재
- GenerationAuthorization과 ReleaseApproval이 각각 현재 hash 변경을 차단
- 브라우저에서 승인→생성→회수→Take 승인→후편집→ReleaseApproval→렌더 E2E 통과
- 전체 테스트, 타입, lint error 0, production build, diff check 통과
- 독립 보안·과금 P0/P1 리뷰 차단 이슈 0

## 12. 구현 시작 전 필요한 외부 준비

- BytePlus ModelArk 계정
- Dreamina Seedance 2.5 리소스 팩/할당량
- 서버 환경변수 `BYTEPLUS_ARK_API_KEY`
- BytePlus 국제 리전 entitlement와 `dreamina-seedance-2-5-260628` 호출 가능 여부
- MIT `LICENSE`/copyright 고지 보존 확인
- 영구 결과 저장 방식을 초기 Windows local store로 할지 R2/S3/Supabase Storage로 시작할지 운영 결정
- Vercel을 쓸 경우 shared Job Repository, object storage, durable reconciler를 먼저 준비

API key는 채팅, Git commit, `.env.example` 값, 로그에 넣지 않는다.

## 13. 권장 첫 실행 순서

1. Gate 0에서 MIT 고지 보존과 autosave/durable transaction 전제를 해결한다.
2. PR A를 구현해 원본 prompt 판단과 의도된 안전·provider divergence를 고정한다.
3. BytePlus 키 없이 PR B에서 project v3 migration, save coordinator, SubmissionClaim/Job repository, asset-store foundation을 구현한다.
4. PR C에서 BytePlus compile-only adapter와 GenerationAuthorization preview/sign을 검증하며 실제 network call은 0으로 유지한다.
5. PR D에서 fake provider로 submit→worker→ingest→Take 승인→영속 import 전체 수직 슬라이스를 완성하고 실사용 flag는 닫아 둔다.
6. PR E에서 post-production과 ReleaseApproval/render gate를 완성한다.
7. PR F에서 Node/runtime·durable render worker·crash matrix를 통과한다.
8. 사용자가 BytePlus 키·할당량을 서버에 설정한다.
9. 별도 승인된 30초 t2v 한 건에만 실사용 flag를 열어 canary한다.
10. 결과 회수·Take QC·타임라인·오디오·렌더를 실제 영상으로 검증한다.
11. 검증 후 BytePlus를 기본 provider로 전환하고 Higgsfield를 legacy fallback으로 제한한다.

이 순서면 기존 소스와 지금까지 만든 ClipJS 기능을 버리지 않으면서, 공급자만 공식 API로 교체하고 수동 파일 작업을 단계적으로 없앨 수 있다.
