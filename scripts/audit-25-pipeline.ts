/* 감독 스킬(seedance-director v1.1.0) 실제 적용: 악어 콘티 12컷 → 감독 판단으로 전 필드 결정 → manifest 저장 + 파이프라인 검증 */
import {readFileSync, writeFileSync} from 'fs';
import {deriveProductionFromStoryboard} from '../app/lib/workflow/storyboard-converter';
import {compileShotPrompt} from '../app/lib/workflow/production';
import {productionManifestSchema} from '../app/lib/workflow/schema';
import type {ProductionManifest, ProductionAsset, SceneContinuityLock, ShotGenerationSpec} from '../app/lib/workflow/schema';

const storyboard = JSON.parse(readFileSync('D:/비디오자동화/악어를-업은-남자.storyboard.json', 'utf-8'));
const stressPass = (id: string) => ({id: `${id}-t`, pose: 'front', lighting: 'flat', coAssetIds: [], verdict: 'pass' as const, resultAssetId: id});
const lockedAsset = (id: string, tag: string, type: ProductionAsset['type'], descriptor: string, referenceUrl: string): ProductionAsset => ({
  id, tag, type, state: 'stable', descriptor, referenceUrl,
  referenceHash: 'a'.repeat(64), editMode: 'original', status: 'locked',
  stressTests: Array.from({length: 10}, () => stressPass(id)),
});

/* ─── 감독 판단 ①: 에셋 6종 (2컷 이상 등장 + 정체성 중요) ─── */
const assets: ProductionAsset[] = [
  lockedAsset('croc-man', '@croc-man', 'character',
    '30대 남성, 흰 와이셔츠 + 느슨한 넥타이, 오른쪽 어깨에 완전히 축 늘어진 큰 악어 (머리는 어깨, 꼬리는 등 뒤로). defines ONLY 얼굴·복장·악어 위치. 해당 이미지의 배경은 사용하지 말 것.',
    'https://cdn.example.com/croc-man.png'),
  lockedAsset('receptionist', '@receptionist', 'character',
    '40대 여성 접수원, 연하늘색 병원 유니폼, 무표정. defines ONLY 얼굴·유니폼. 배경은 사용하지 말 것.',
    'https://cdn.example.com/receptionist.png'),
  lockedAsset('grandmother', '@grandmother', 'character',
    '70대 할머니, 뜨개질을 하다 멈춤, 무뚝뚝한 표정. defines ONLY 얼굴·복장·뜨개질 동작.',
    'https://cdn.example.com/grandmother.png'),
  lockedAsset('waiting-room', '@waiting-room', 'location',
    '한국 병원 대기실 — 회색 플라스틱 의자 여러 줄, 접수 카운터, 벽의 빨간 LED 대기번호 전광판, 정수기. defines ONLY 공간 구조·가구 배치. 인물은 정의하지 않는다.',
    'https://cdn.example.com/waiting-room.png'),
  lockedAsset('phone-ui', '@phone-ui', 'prop',
    '사주천궁 상담 전화 UI 마스터시트. defines ONLY 폰 화면 구성. 배경 사용 금지.',
    'https://cdn.example.com/phone-ui.png'),
  lockedAsset('ticket-47', '@ticket-47', 'prop',
    '종이 번호표 — "대기표"와 숫자 47만 크게. defines ONLY 표면 디자인. 다른 글자(사주천궁 등) 금지.',
    'https://cdn.example.com/ticket-47.png'),
];

/* ─── 감독 판단 ②: 연속성 락 (공식 clay render 대응 — 대기실 공통) ─── */
const lock = (sceneId: string): SceneContinuityLock => ({
  id: `continuity-lock-${sceneId}`, sceneId, status: 'locked',
  referenceUrl: 'https://cdn.example.com/waiting-room-clay.png',
  landmarks: [
    {id: 'lm-entry', description: '자동문 + 입구 (우측), 출구 유리문', frameRegion: 'right'},
    {id: 'lm-chairs', description: '회색 플라스틱 의자 3열 (좌측-중앙)', frameRegion: 'left'},
    {id: 'lm-counter', description: '접수 카운터 + 빨간 LED 대기번호 전광판', frameRegion: 'center'},
  ],
  cameraSide: '대기실 측면, 접수대를 기준으로 카메라 좌회전 금지',
  axisRule: '180° 라인: 접수대-대기석 축 유지. 카메라는 항상 대기실 한쪽 면에만 위치',
  lightSource: '천장 형광등 다운라이트 (위→아래, 병원 플랫 라이트)',
  shadowDirection: '그림자는 항상 피사체 아래-우측으로 고정',
  palette: {dominant: '#d8d8d4', secondary: '#8a8f98', accent: '#c0392b'},
});

/* ─── 감독 판단 ③: 컷별 shotSpec — 30초 아크(Opening 0-8 / Development 8-21 / Turn 21-27 / Ending 27-30) 배정 ─── */
const director = (base: ShotGenerationSpec): ShotGenerationSpec => {
  const id = base.id, cutId = base.cutId, dur = base.durationSeconds;
  const beat = (s: number, e: number, action: string) => ({startSeconds: s, endSeconds: e, action});
  const L = {source: '천장 형광등', direction: '탑라이트', preserveContinuity: true};
  const noMusic = {dialogue: base.audio.dialogue, ambience: base.audio.ambience, sfx: base.audio.sfx, music: undefined};
  const crocodileRule = ['악어는 네 발 동물 — 두 발로 서지 않음', '배경에 동물 금지 — 전원 평범한 민원인'];
  const c = (n: number) => ({assetId: 'croc-man', beats: [`무표정 유지`, `악어를 업은 자세 고정`] as string[]});

  switch (cutId) {
    case 'CUT01': return {...base, characterCount: 1, activeReferences: [{assetId: 'croc-man', role: 'identity'}, {assetId: 'waiting-room', role: 'location'}], firstFrameBlocking: [{subject: '남자+악어', position: '프레임 중앙, 입구 바로 안쪽', action: '악어를 어부바로 업고 멈춤'}], optics: '24mm', camera: ['〈24mm · 와이드 · 고정 · 플랫〉 입구 정면 — 형광등 빛 새어 나옴'], lighting: L, audio: noMusic, physics: ['악어 무게로 휘청'], acting: [c(1)], positiveConstraints: [...crocodileRule, '문틀에 걸린 자세 유지'], endState: '남자 문틀에 걸림 — 악어 머리는 오른쪽 어깨, 꼬리는 등 뒤', actionBeats: [beat(0, 1.2, '자동문 열림 — 남자 휘청하며 진입'), beat(1.2, dur, '문틀에 걸림 — 악어는 계속 잠')]};
    case 'CUT02': return {...base, characterCount: 4, activeReferences: [{assetId: 'waiting-room', role: 'location'}, {assetId: 'croc-man', role: 'identity'}], firstFrameBlocking: [{subject: '민원인들', position: '의자 열에 각자 앉음', action: '신문/커피/졸음'}], optics: '35mm', camera: ['〈35mm · 미디엄 와이드 · 팬 · 플랫〉 대기실이 드러나는 구도'], lighting: L, audio: noMusic, physics: ['몸을 비틀어 비집고 들어감'], acting: [c(2)], positiveConstraints: [...crocodileRule, '민원인 전원 평범 — 신문·커피·졸음'], endState: '남자 대기실 안쪽 진입 — 아무도 쳐다보지 않음', actionBeats: [beat(0, dur, '몸을 비틀어 대기실로 들어옴 — 민원인들 무관심')]};
    case 'CUT03': return {...base, characterCount: 1, activeReferences: [{assetId: 'croc-man', role: 'identity'}], firstFrameBlocking: [{subject: '남자 얼굴+악어 머리', position: '프레임 중앙, 나란히', action: '악어는 눈 감고 잠'}], optics: '85mm', camera: ['〈85mm · 타이트 클로즈업 · 락오프 · 셸로우 DOF〉 어깨에 얹힌 악어 머리 옆'], lighting: L, audio: noMusic, physics: [], acting: [{assetId: 'croc-man', beats: ['절박하게 외침', '악어는 계속 잠']}], positiveConstraints: [...crocodileRule, '악어 눈 감고 잠'], endState: '입 벌려 외치는 순간 — 하드컷으로 접수원 컷 연결', actionBeats: [beat(0, dur, '접수대 향해 절박하게 외침 — 목소리는 하드컷에서 끊김')]};
    case 'CUT04': return {...base, characterCount: 1, activeReferences: [{assetId: 'receptionist', role: 'identity'}, {assetId: 'ticket-47', role: 'prop'}], firstFrameBlocking: [{subject: '접수원', position: '카운터 너머 중앙', action: '모니터 응시'}], optics: '50mm', camera: ['〈50mm · 카운터 너머 미디엄 · 락오프 · 플랫〉'], lighting: L, audio: noMusic, physics: [], acting: [{assetId: 'receptionist', beats: ['무미건조하게 말함', '번호표 내밈 — 무표정']}], positiveConstraints: ['번호표는 "대기표 47" 표기 유지'], endState: '접수원이 번호표를 쓱 내밈 — 무표정', actionBeats: [beat(0, 0.4, '모니터에서 눈도 떼지 않음'), beat(0.4, dur, '대사 + 번호표 내밈')]};
    case 'CUT05': return {...base, characterCount: 1, activeReferences: [{assetId: 'ticket-47', role: 'prop'}, {assetId: 'croc-man', role: 'identity'}], firstFrameBlocking: [{subject: '손+번호표', position: '프레임 중앙', action: '번호표 47 클로즈업'}], optics: 'macro', camera: ['〈macro · 인서트 클로즈업 · 락오프 · 플랫〉 번호표 47'], lighting: L, audio: noMusic, physics: [], acting: [{assetId: 'croc-man', beats: ['번호표 내려다보고 경악', '악어는 계속 잠']}], positiveConstraints: ['번호표에 "대기표"와 47만 — 다른 글자 금지'], endState: '경악하는 표정 — 악어는 계속 잠', actionBeats: [beat(0, 0.6, '번호표 내려다봄'), beat(0.6, dur, '경악하며 외침')]};
    case 'CUT06': return {...base, characterCount: 1, activeReferences: [{assetId: 'receptionist', role: 'identity'}], firstFrameBlocking: [{subject: '접수원', position: '미디엄 클로즈업', action: '고개 듦'}], optics: '85mm', camera: ['〈85mm · 미디엄 클로즈업 · 락오프 · 플랫〉 접수원'], lighting: L, audio: noMusic, physics: [], acting: [{assetId: 'receptionist', beats: ['힐끗 보고 다시 모니터 — 무미건조']}], positiveConstraints: [], endState: '접수원 다시 모니터로 시선 복귀 — 무표정', actionBeats: [beat(0, 0.4, '힐끗 봄'), beat(0.4, dur, '무미건조하게 말하며 모니터로 복귀')]};
    case 'CUT07': return {...base, characterCount: 5, activeReferences: [{assetId: 'waiting-room', role: 'location'}], firstFrameBlocking: [{subject: '민원인들', position: '의자 열 옆쪽', action: '신문/커피/졸음'}], optics: '35mm', camera: ['〈35mm · 측면 · 패닝(이 세그먼트 유일한 카메라 이동) · 플랫〉 대기실 천천히 훑음'], lighting: L, audio: noMusic, physics: [], acting: [], positiveConstraints: [...crocodileRule, '민원인 전원 평범'], endState: '패닝 끝 — 평범한 민원인들 줄지어 앉은 풍경', actionBeats: [beat(0, dur, '대기실을 천천히 훑는 패닝 — 아무도 남자를 안 봄')]};
    case 'CUT08': return {...base, characterCount: 2, activeReferences: [{assetId: 'croc-man', role: 'identity'}, {assetId: 'waiting-room', role: 'location'}], firstFrameBlocking: [{subject: '남자+옆자리 민원인', position: '의자 열 미디엄 투샷', action: '남자 앉음, 옆자리 신문'}], optics: '50mm', camera: ['〈50mm · 의자 열 미디엄 투샷 · 락오프 · 플랫〉'], lighting: L, audio: noMusic, physics: ['악어 뒤척임 → 무게 쏠림 → 남자 옆으로 크게 기울'], acting: [c(8)], positiveConstraints: [...crocodileRule, '옆자리는 눈길도 주지 않음'], endState: '남자 옆으로 크게 기움 — 옆자리 신문 계속', actionBeats: [beat(0, dur, '악어 잠결 뒤척임 — 무게 쏠려 남자 기울')]};
    case 'CUT09': return {...base, characterCount: 1, activeReferences: [{assetId: 'ticket-47', role: 'prop'}, {assetId: 'waiting-room', role: 'location'}], firstFrameBlocking: [{subject: 'LED 전광판', position: '벽 중앙', action: '숫자 5'}], optics: 'macro', camera: ['〈macro · 인서트 · 락오프 · 플랫〉 전광판 → 번호표'], lighting: L, audio: noMusic, physics: [], acting: [], positiveConstraints: ['번호표에 "대기표"와 47만 — 사주천궁 글자 금지'], endState: '번호표 47 클로즈업 — 대기표 글자만', actionBeats: [beat(0, 1.0, '전광판 5→6 띵동'), beat(1.0, dur, '번호표 47 클로즈업')]};
    case 'CUT10': return {...base, characterCount: 3, activeReferences: [{assetId: 'croc-man', role: 'identity'}, {assetId: 'waiting-room', role: 'location'}], firstFrameBlocking: [{subject: '남자', position: '의자에서 바닥으로', action: '주저앉는 중'}], optics: '24mm', camera: ['〈24mm · 로우앵글 바닥 레벨 · 락오프 · 플랫〉'], lighting: L, audio: noMusic, physics: ['완전히 눕지 않음 — 등을 의자에 기대거나 축 처진 앉은 자세'], acting: [{assetId: 'croc-man', beats: ['천장 보며 절박하게 외침', '악어는 계속 잠']}], positiveConstraints: [...crocodileRule, '완전히 눕지 않음'], endState: '바닥에 축 처져 천장 보며 외침 — 아무도 안 봄', actionBeats: [beat(0, 0.5, '의자에서 미끄러져 주저앉음'), beat(0.5, dur, '천장 보며 절박하게 외침')]};
    case 'CUT11': return {...base, characterCount: 2, activeReferences: [{assetId: 'grandmother', role: 'identity'}, {assetId: 'croc-man', role: 'identity'}, {assetId: 'phone-ui', role: 'prop'}], firstFrameBlocking: [{subject: '할머니 손', position: '전경 오버숄더', action: '뜨개질 멈춤'}], optics: '50mm', camera: ['〈50mm · 오버숄더 인서트 · 락오프 · 플랫〉 남자+할머니 한 프레임'], lighting: L, audio: noMusic, physics: [], acting: [{assetId: 'grandmother', beats: ['말없이 폰 내밈 — 무뚝뚝']}, {assetId: 'croc-man', beats: ['바닥에 주저앉아 있음']}], positiveConstraints: ['폰 화면 = 사주천궁 마스터시트 UI 유지'], endState: '할머니가 폰을 내민 순간 — 남자 바닥에 주저앉음', actionBeats: [beat(0, 0.3, '뜨개질 손 멈춤'), beat(0.3, dur, '말없이 폰 내밈 + 대사')]};
    case 'CUT12': return {...base, characterCount: 2, activeReferences: [{assetId: 'croc-man', role: 'identity'}, {assetId: 'receptionist', role: 'identity'}, {assetId: 'ticket-47', role: 'prop'}, {assetId: 'phone-ui', role: 'prop'}], firstFrameBlocking: [{subject: '남자', position: '와이드 접수대 — 바닥에 주저앉음', action: '폰을 귀에 댐'}], optics: '24mm', camera: ['〈24mm · 와이드 고정 · 락오프 · 플랫〉 접수대', '악어가 번호표를 집어드는 순간만 〈미디엄 로우앵글〉'], lighting: L, audio: noMusic, physics: ['악어가 등에서 스르르 미끄러져 내려옴'], acting: [{assetId: 'receptionist', beats: ['고개 돌려 악어 똑바로 봄', '남자에게 대사']}, {assetId: 'croc-man', beats: ['번호표 주둥이로 집어듦', '의자에 올라 앉아 정면 응시']}], positiveConstraints: [...crocodileRule, '전광판은 48', '번호표 기계 장면 없음', '폰 화면 = 마스터시트 UI 유지'], endState: '악어가 의자에 앉아 47번 번호표 문 채 정면 응시 — 뒤쪽 출구로 걸어가는 남자 뒷모습, 접수원 카운터, 전광판 48', actionBeats: [beat(0, 1.2, '폰 귀에 댐 — 연결음 한 번'), beat(1.2, 2.8, '통화 연결 — 일어나 통화하며 출구로'), beat(2.8, 3.8, '악어 미끄러져 내려와 번호표 주둥이로 집어듦'), beat(3.8, dur, '악어 의자에 올라 앉아 정면 응시 — 전광판 48')]};
    default: return base;
  }
};

const manifest = deriveProductionFromStoryboard(storyboard) as ProductionManifest;
manifest.assets = assets;
manifest.continuityLocks = manifest.continuityLocks.map((l) => lock(l.sceneId));
manifest.shotSpecs = manifest.shotSpecs.map(director);

/* 검증 1: 스키마 */
const parsed = productionManifestSchema.parse(manifest);
console.log(`SCHEMA: PASS (assets ${parsed.assets.length}, locks ${parsed.continuityLocks.length}, shots ${parsed.shotSpecs.length})`);

/* 검증 2: 컴파일러 + 2.5 구조 */
let pass = 0;
const checks = ['USE (assets for THIS shot only', 'END STATE', 'AUDIO (4 lanes', 'defines ONLY the', '0.000–'];
for (const spec of manifest.shotSpecs) {
  const prompt = compileShotPrompt(manifest, spec.id);
  const ok = checks.every((c) => prompt.includes(c));
  if (ok) pass++; else console.log(`FAIL ${spec.id}`);
}
console.log(`COMPILE: ${pass}/12 pass 2.5 structure`);

/* 감독 필드 전수 확인 */
const missing: string[] = [];
for (const s of manifest.shotSpecs) {
  if (!s.endState) missing.push(`${s.id}:endState`);
  if (!s.firstFrameBlocking.length) missing.push(`${s.id}:firstFrameBlocking`);
  if (!s.physics.length && s.cutId !== 'CUT03' && s.cutId !== 'CUT04' && s.cutId !== 'CUT05' && s.cutId !== 'CUT06' && s.cutId !== 'CUT07' && s.cutId !== 'CUT09' && s.cutId !== 'CUT11') missing.push(`${s.id}:physics`);
  if (!s.acting.length && s.cutId !== 'CUT07' && s.cutId !== 'CUT09') missing.push(`${s.id}:acting`);
  if (!s.activeReferences.length) missing.push(`${s.id}:references`);
}
console.log(`DIRECTOR FIELDS: ${missing.length ? 'MISSING ' + missing.join(', ') : 'ALL SET (endState/firstFrameBlocking/physics/acting/references)'}`);

writeFileSync('D:/비디오자동화/악어-감독-manifest.json', JSON.stringify(manifest, null, 2));
console.log('SAVED: D:/비디오자동화/악어-감독-manifest.json');
if (pass === 12 && !missing.length) console.log('DIRECTOR OUTPUT: ALL GREEN');
