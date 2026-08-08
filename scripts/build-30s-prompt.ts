/* 참조 팩 실연결 + 30초 통합 프롬프트 생성 (감독 manifest 기반) */
import {readFileSync, writeFileSync} from 'fs';
import {createHash} from 'crypto';
import {productionManifestSchema, storyboardSchema} from '../app/lib/workflow/schema';

const REF_DIR = 'D:/비디오자동화/reference-pack';
const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

const manifestInput = JSON.parse(readFileSync('D:/비디오자동화/사주카페-감독-manifest.json', 'utf-8')) as {assets?: Array<Record<string, unknown>>};
const legacyReceptionist = manifestInput.assets?.find((asset) => asset.id === 'receptionist');
if (legacyReceptionist) {
  legacyReceptionist.referenceUrl = `${REF_DIR}/receptionist-master.png`;
  legacyReceptionist.referenceHash = sha256(`${REF_DIR}/receptionist-master.png`);
}
const manifest = productionManifestSchema.parse(manifestInput);
const storyboard = storyboardSchema.parse(JSON.parse(readFileSync('D:/비디오자동화/사주카페-호랑이-30s.storyboard.json', 'utf-8')));

/* ① referenceUrl 실경로 + referenceHash 계산 */
const fileFor: Record<string, string> = {
  'croc-man': 'croc-man.png', 'receptionist': 'receptionist-master.png', 'grandmother': 'grandmother.png',
  'waiting-room': 'waiting-room.png', 'phone-ui': 'phone-ui.png', 'ticket-47': 'ticket-47.png',
};
const receptionist = manifest.assets.find((asset) => asset.id === 'receptionist');
if (receptionist) {
  receptionist.descriptor = '40대 한국 여성 도사 접수원, 검은 도사복, 무표정. defines ONLY 얼굴·검은 도사복.';
}
for (const a of manifest.assets) {
  const f = fileFor[a.id];
  if (f) { a.referenceUrl = `${REF_DIR}/${f}`; a.referenceHash = sha256(`${REF_DIR}/${f}`); }
}
for (const l of manifest.continuityLocks) l.referenceUrl = `${REF_DIR}/waiting-room.png`;

/* ② 30초 통합 프롬프트: 스토리보드 절대시간 기준 컷별 세그먼트 + 감독 필드 */
const cutById = new Map(storyboard.cuts.map((cut) => [cut.id, cut]));
const sections: string[] = [];
for (const spec of manifest.shotSpecs) {
  const cut = cutById.get(spec.cutId) as {absoluteStartSeconds?: number; title?: string} | undefined;
  const absStart = cut?.absoluteStartSeconds ?? 0;
  const absEnd = absStart + spec.durationSeconds;
  const beats = spec.actionBeats.map((b) => `${(absStart + b.startSeconds).toFixed(1)}–${(absStart + b.endSeconds).toFixed(1)}s: ${b.action}`).join('\n    ');
  sections.push(`[${absStart.toFixed(1)}–${absEnd.toFixed(1)}s] ${spec.cutId} — ${cut?.title ?? ''}\n  CAMERA: ${spec.camera.join(' / ')}\n  OPTICS: ${spec.optics}\n  ${beats}\n  END: ${spec.endState}`);
}

const audio = manifest.shotSpecs.flatMap((s) => {
  const out: string[] = [];
  if (s.audio.dialogue && s.audio.dialogue !== '—') out.push(s.audio.dialogue);
  if (s.audio.sfx && s.audio.sfx !== '—') out.push(`<${s.audio.sfx}>`);
  return out;
});

const refs = manifest.assets
  .filter((asset) => asset.referenceUrl)
  .map((asset) => `참조 이미지 [${asset.id}] — ${asset.descriptor}`)
  .join('\n');

const prompt = [
  '한국 TV CF, 포토리얼리즘, 데드팬 코미디. 사주카페 대기 공간. 따뜻한 카페 조명 플랫 라이트, 저채도 팔레트. 호랑이는 네 발 동물 — 두 발로 서지 않는다. 배경 상담 대기자는 전원 평범한 사람 (동물 금지). 30초, 16:9, 24fps.',
  '',
  `=== 캐릭터/공간 프로필 (defines ONLY) ===
캐릭터 [남자]: 30대 한국 남성, 흰 와이셔츠 + 느슨한 넥타이, 오른쪽 어깨에 완전히 축 늘어진 큰 호랑이 (머리는 어깨, 꼬리는 등 뒤로, 호랑이는 잠자는 상태). 따뜻한 카페 조명 플랫 라이트, 저채도 팔레트, 데드팬 코미디 톤.
캐릭터 [도사 접수원]: 40대 한국 여성 도사 접수원, 검은 도사복, 무표정.
캐릭터 [할머니]: 70대 할머니, 뜨개질을 하다 멈춤, 무뚝뚝한 표정, 무채색 카디건.
공간 [사주카페]: 한국 사주카페 대기 공간 — 나무 좌식 의자 여러 줄, 접수 카운터, 벽의 빨간 LED 대기번호 전광판, 다기 선반. 인물은 배치에 따라.
소품 [폰]: 사주천궁 상담 전화 UI 화면 (스마트폰).
소품 [번호표]: 종이 번호표 — "대기표"와 숫자 47만 크게. 다른 글자(사주천궁 등) 금지.`,
  '',
  '=== 참조 팩 설명 ===',
  refs,
  '',
  '=== 시간 기반 시퀀스 (컷 순서대로) ===',
  ...sections,
  '',
  '=== 오디오 4레인 ===',
  ...audio.map((a, i) => `${i + 1}. ${a}`),
  '(배경음악 없음 — 음악 없이 대사·효과음·앰비언스만)',
  '',
  '=== 네거티브 ===',
  '자막·워터마크·로고·실존 브랜드·실존 인물 얼굴 금지. 다중 얼굴·얼굴 변형·사지 추가·손 변형 금지. 의상 색 변화·조명 깜빡임 금지. 호랑이가 두 발로 서는 것 금지. 배경 동물 금지. 번호표에는 "대기표"와 숫자만 — 사주천궁 글자 금지.',
].join('\n');

writeFileSync('D:/비디오자동화/사주카페-30s-prompt.txt', prompt, 'utf-8');
writeFileSync('D:/비디오자동화/사주카페-감독-manifest.json', JSON.stringify(manifest, null, 2), 'utf-8');
console.log('MANIFEST: referenceUrl/hash 실연결 완료');
console.log('PROMPT: 사주카페-30s-prompt.txt 저장 (' + prompt.length + ' chars)');
console.log('--- 첫 30줄 ---');
console.log(prompt.split('\n').slice(0, 30).join('\n'));
