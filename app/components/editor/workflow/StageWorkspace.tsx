'use client';

import Image from 'next/image';
import type {CharacterSheet, InterviewBrief, Storyboard} from '@/app/lib/workflow/schema';
import type {ProjectWorkspaceId} from '@/app/lib/editor/project-workspace';

type StageWorkspaceProps = {
  workspace: Exclude<ProjectWorkspaceId, 'edit'>;
  interviewBrief?: InterviewBrief;
  characterSheet?: CharacterSheet;
  storyboard?: Storyboard;
  onOpenWorkflow: () => void;
  onOpenEdit: () => void;
};

const emptyCard = (title: string, description: string) => (
  <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.025] p-8 text-center">
    <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-fuchsia-500/15 text-lg text-fuchsia-300">✦</span>
    <h3 className="text-sm font-bold text-white">{title}</h3>
    <p className="mt-2 max-w-sm text-xs leading-5 text-gray-500">{description}</p>
  </div>
);

const MOCK_CHARACTER = {
  name: '시바견 루이',
  breed: '크림색 시바견 캐릭터',
  visualTags: ['정면·측면', '감정 표정', '소품 기준', '일관성 기준'],
  palette: {primary: '#C58F55', secondary: '#F2D3A5', accent: '#17120E'},
};

const MOCK_CUTS = [
  {id: 'CUT01', title: '미로 속의 고민', absoluteStartSeconds: 0, absoluteEndSeconds: 4, action: '어두운 메모의 벽 사이로 인물이 천천히 걸어간다.'},
  {id: 'CUT02', title: '빛을 발견하다', absoluteStartSeconds: 4, absoluteEndSeconds: 8, action: '통로 끝 보랏빛 출구를 발견하고 발걸음을 멈춘다.'},
  {id: 'CUT03', title: '공간이 열리다', absoluteStartSeconds: 8, absoluteEndSeconds: 12, action: '고민의 공간이 거대한 빛의 홀로 전환된다.'},
  {id: 'CUT04', title: '마음이 풀리는 순간', absoluteStartSeconds: 12, absoluteEndSeconds: 15, action: '따뜻한 빛 속에서 결심한 듯 앞으로 나아간다.'},
] as const;

export default function StageWorkspace({workspace, interviewBrief, characterSheet, storyboard, onOpenWorkflow, onOpenEdit}: StageWorkspaceProps) {
  const displayedCharacter = characterSheet ?? MOCK_CHARACTER;
  if (workspace === 'interview') {
    return (
      <section className="flex h-full min-h-0 flex-col bg-[#0b0b0f]">
        <header className="border-b border-white/10 px-6 py-4">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-fuchsia-400">Step 01 · DeepSeek planning</span>
          <h1 className="mt-1 text-xl font-black text-white">AI 인터뷰</h1>
          <p className="mt-1 text-xs text-gray-500">만들고 싶은 영상을 자연어로 설명하고 기획안을 완성하세요.</p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            <div className="rounded-2xl border border-fuchsia-500/20 bg-gradient-to-br from-fuchsia-500/10 to-purple-500/5 p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-fuchsia-500 text-sm font-black text-white">AI</span>
                <div><h2 className="text-sm font-bold text-white">무엇을 만들까요?</h2><p className="mt-0.5 text-xs text-gray-400">대상, 장면, 길이, 분위기를 한 문장으로 적어도 됩니다.</p></div>
              </div>
              <button type="button" onClick={onOpenWorkflow} className="mt-5 w-full rounded-xl border border-fuchsia-400/30 bg-black/30 px-4 py-4 text-left text-sm text-gray-400 transition hover:border-fuchsia-400/60 hover:bg-black/50">
                여기를 눌러 DeepSeek 인터뷰 입력창 열기 <span className="float-right text-fuchsia-300">→</span>
              </button>
            </div>
            {interviewBrief ? (
              <div className="grid gap-3 md:grid-cols-2">
                {[
                  ['주제', interviewBrief.subject], ['핵심 행동', interviewBrief.action], ['분위기', interviewBrief.tone], ['길이', `${interviewBrief.durationSeconds}초`],
                ].map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-[#14141a] p-4"><div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</div><div className="mt-2 text-sm font-semibold leading-6 text-gray-100">{value}</div></div>)}
              </div>
            ) : emptyCard('아직 인터뷰 결과가 없습니다', '오른쪽 AI 패널에서 첫 문장을 입력하면 브리프가 이곳에 정리됩니다.')}
          </div>
        </div>
      </section>
    );
  }

  if (workspace === 'reference') {
    return (
      <section className="h-full overflow-y-auto bg-[#0b0b0f] p-6">
        <div className="mx-auto max-w-5xl">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-fuchsia-400">Step 02 · continuity lock</span>
          <h1 className="mt-1 text-xl font-black text-white">기준 시트</h1>
          <p className="mt-1 text-xs text-gray-500">영상 전체에서 유지할 캐릭터·제품·공간의 기준을 검수합니다.</p>
          {(
            <div className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
              <article className="overflow-hidden rounded-2xl border border-white/10 bg-[#14141a]">
                <div className="relative aspect-video overflow-hidden bg-black">
                  <Image src="/mock-assets/reference-shiba.webp" alt="컴퓨터에서 가져온 실제 마스터 시트 예시" fill priority className="object-cover" sizes="(max-width: 1200px) 70vw, 900px" />
                  <span className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/65 px-3 py-1 text-[10px] font-bold text-white backdrop-blur">로컬 실제 자산 · 마스터 시트</span>
                </div>
                <div className="p-5"><h2 className="text-lg font-black text-white">{displayedCharacter.name}</h2><p className="mt-1 text-xs text-gray-400">{displayedCharacter.breed ?? '캐릭터 기준'}</p><div className="mt-4 flex flex-wrap gap-2">{displayedCharacter.visualTags.map((tag) => <span key={tag} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-gray-300">{tag}</span>)}</div></div>
              </article>
              <aside className="space-y-4 rounded-2xl border border-white/10 bg-[#14141a] p-5">
                <h3 className="text-sm font-bold text-white">컬러 팔레트</h3>
                {Object.entries(displayedCharacter.palette).map(([label, color]) => <div key={label} className="flex items-center gap-3"><span className="h-10 w-10 rounded-xl border border-white/10" style={{backgroundColor: color}}/><div><div className="text-[10px] uppercase text-gray-500">{label}</div><div className="font-mono text-xs text-gray-200">{color}</div></div></div>)}
                <button type="button" onClick={onOpenWorkflow} className="mt-3 w-full rounded-xl bg-fuchsia-600 px-4 py-3 text-xs font-bold text-white hover:bg-fuchsia-500">기준 시트 검수·승인</button>
              </aside>
            </div>
          )}
        </div>
      </section>
    );
  }

  if (workspace === 'storyboard') {
    const cuts = storyboard?.cuts?.length
      ? storyboard.cuts.map((cut) => ({...cut, action: cut.shots[0]?.action ?? ''}))
      : [...MOCK_CUTS];
    return (
      <section className="flex h-full min-h-0 flex-col bg-[#0b0b0f]">
        <header className="border-b border-white/10 px-6 py-4"><span className="text-[10px] font-bold uppercase tracking-[0.2em] text-fuchsia-400">Step 03 · visual plan</span><h1 className="mt-1 text-xl font-black text-white">스토리보드</h1><p className="mt-1 text-xs text-gray-500">장면 순서와 시작·끝 화면을 검수하고 승인합니다.</p></header>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="grid gap-4 xl:grid-cols-2">{cuts.map((cut, index) => <article key={cut.id} className="overflow-hidden rounded-2xl border border-white/10 bg-[#14141a] transition hover:border-fuchsia-500/40"><div className="relative aspect-video overflow-hidden bg-black"><Image src={`/mock-assets/story-0${(index % 3) + 1}.webp`} alt={`${cut.title} 로컬 실제 이미지 예시`} fill className="object-cover transition duration-300 hover:scale-[1.03]" sizes="(max-width: 1200px) 50vw, 420px"/><span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[9px] font-bold text-white">로컬 자산 {index + 1}</span></div><div className="p-4"><div className="flex items-center justify-between"><span className="text-[10px] font-bold text-fuchsia-400">{cut.id}</span><span className="font-mono text-[10px] text-gray-500">{cut.absoluteStartSeconds}s–{cut.absoluteEndSeconds}s</span></div><h2 className="mt-2 text-sm font-bold text-white">{cut.title}</h2><p className="mt-2 line-clamp-2 text-xs leading-5 text-gray-400">{cut.action}</p></div></article>)}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="h-full overflow-y-auto bg-[#0b0b0f] p-6">
      <div className="mx-auto max-w-5xl">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-fuchsia-400">Step 04 · approval gate</span>
        <h1 className="mt-1 text-xl font-black text-white">영상 생성</h1>
        <p className="mt-1 text-xs text-gray-500">승인된 기획과 과금 안전 조건을 확인한 뒤에만 생성합니다.</p>
        <div className="mt-6 grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
            <div className="relative aspect-video">
              <video className="h-full w-full object-contain" src="/mock-assets/sample-video-web.mp4" poster="/mock-assets/video-poster.webp" controls muted playsInline preload="metadata" />
              <span className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/15 bg-black/65 px-3 py-1 text-[10px] font-bold text-white backdrop-blur">로컬 실제 영상 · 6초 미리보기</span>
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-[#14141a] p-5"><h2 className="text-sm font-bold text-white">생성 준비 상태</h2><div className="mt-4 space-y-3 text-xs">{[['브리프', Boolean(interviewBrief)], ['기준 시트', Boolean(characterSheet)], ['스토리보드', Boolean(storyboard)]].map(([label, ready]) => <div key={String(label)} className="flex items-center justify-between border-b border-white/5 pb-3"><span className="text-gray-400">{label}</span><span className={ready ? 'text-emerald-400' : 'text-amber-400'}>{ready ? '준비됨' : '대기'}</span></div>)}</div></div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5"><div className="text-xs font-bold text-amber-300">유료 제출 잠금</div><p className="mt-3 text-xs leading-5 text-gray-400">Creative 승인, Generation 승인, authorization이 모두 통과해야 제출할 수 있습니다.</p><button type="button" onClick={onOpenWorkflow} className="mt-5 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-bold text-white hover:bg-white/10">승인 및 생성 설정 열기</button></div>
          </div>
        </div>
        <button type="button" onClick={onOpenEdit} className="mt-4 text-xs font-semibold text-fuchsia-300 hover:text-fuchsia-200">전문 편집 화면 미리 보기 →</button>
      </div>
    </section>
  );
}
