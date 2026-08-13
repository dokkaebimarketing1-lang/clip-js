'use client';

import Image from 'next/image';
import {FormEvent, useState} from 'react';
import {useAppDispatch, useAppSelector} from '@/app/store';
import {setWorkflow} from '@/app/store/slices/projectSlice';
import {
  characterSheetSchema,
  interviewBriefSchema,
  storyboardSchema,
  type CharacterSheet,
  type InterviewBrief,
  type Storyboard,
} from '@/app/lib/workflow/schema';
import {seedanceMasterSettingsSchema} from '@/app/lib/workflow/seedance-master';
import type {ProjectWorkspaceId} from '@/app/lib/editor/project-workspace';

type StageWorkspaceProps = {
  workspace: ProjectWorkspaceId;
  interviewBrief?: InterviewBrief;
  characterSheet?: CharacterSheet;
  storyboard?: Storyboard;
  sampleMode: boolean;
  onEnableSample: () => void;
  onOpenEdit: () => void;
};

const SAMPLE_CHARACTER = {
  name: '시바견 루이',
  breed: '크림색 시바견 캐릭터',
  visualTags: ['정면·측면', '감정 표정', '소품 기준', '일관성 기준'],
  palette: {dominant: '#C58F55', secondary: '#F2D3A5', accent: '#17120E'},
};

const SAMPLE_CUTS = [
  {id: 'SAMPLE-01', title: '창가의 루이', action: '따뜻한 오후, 루이가 창밖을 바라본다.', start: 0, end: 2},
  {id: 'SAMPLE-02', title: '시선 전환', action: '루이가 카메라 쪽으로 천천히 고개를 돌린다.', start: 2, end: 4},
  {id: 'SAMPLE-03', title: '표정 클로즈업', action: '편안한 표정을 가까이 담는다.', start: 4, end: 5},
  {id: 'SAMPLE-04', title: '엔딩 포즈', action: '루이가 화면 중앙에서 포즈를 유지한다.', start: 5, end: 6},
];

const EmptyState = ({title, description, action}: {title: string; description: string; action?: React.ReactNode}) => (
  <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-white/15 bg-white/[0.025] p-10 text-center">
    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-gray-300">아직 생성되지 않음</span>
    <h2 className="mt-4 text-xl font-black text-white text-balance">{title}</h2>
    <p className="mt-2 max-w-lg text-sm leading-6 text-gray-400 text-pretty">{description}</p>
    {action ? <div className="mt-6">{action}</div> : null}
  </div>
);

export default function StageWorkspace({workspace, interviewBrief, characterSheet, storyboard, sampleMode, onEnableSample, onOpenEdit}: StageWorkspaceProps) {
  const dispatch = useAppDispatch();
  const workflow = useAppSelector((state) => state.projectState.workflow);
  const [sentence, setSentence] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);

  const compose = async (event: FormEvent) => {
    event.preventDefault();
    const input = sentence.trim();
    if (!input || isComposing) return;
    setIsComposing(true);
    setComposeError(null);
    try {
      const response = await fetch('/api/vlog/compose', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({sentence: input}),
      });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'AI 기획을 완료하지 못했습니다.');
      dispatch(setWorkflow({
        ...workflow,
        interviewBrief: interviewBriefSchema.parse(payload.interviewBrief),
        characterSheet: characterSheetSchema.parse(payload.characterSheet),
        storyboard: storyboardSchema.parse(payload.storyboard),
        seedanceMaster: seedanceMasterSettingsSchema.parse(payload.seedanceMaster),
      }));
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : 'AI 기획을 완료하지 못했습니다.');
    } finally {
      setIsComposing(false);
    }
  };

  if (workspace === 'interview') {
    return (
      <section className="h-full overflow-y-auto bg-[#0c0b10] p-6 lg:p-10">
        <div className="mx-auto flex min-h-full max-w-5xl flex-col">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-fuchsia-300">1 · AI 인터뷰</p>
              <h1 className="mt-2 text-3xl font-black text-white text-balance">어떤 영상을 만들고 싶으세요?</h1>
              <p className="mt-2 text-sm leading-6 text-gray-400">한 문장으로 시작하면 AI가 브리프·기준 시트·스토리보드를 구성합니다.</p>
            </div>
            {!sampleMode && !interviewBrief ? <button type="button" onClick={onEnableSample} className="shrink-0 rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-gray-200 hover:border-fuchsia-400/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400">샘플 프로젝트 보기</button> : null}
          </div>

          <div className="mt-10 flex-1 space-y-5">
            {interviewBrief ? (
              <div className="max-w-3xl rounded-3xl border border-fuchsia-400/20 bg-fuchsia-500/[0.06] p-6">
                <div className="flex items-center gap-2 text-xs font-bold text-fuchsia-200"><span className="h-2 w-2 rounded-full bg-fuchsia-400"/>AI 기획 완료</div>
                <h3 className="text-2xl font-black text-white">{interviewBrief.subject}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-400">{interviewBrief.action}</p>
                <div className="mt-5 flex flex-wrap gap-2 text-xs text-gray-300">
                  <span className="rounded-full bg-white/5 px-3 py-1.5">{interviewBrief.durationSeconds}초</span>
                  <span className="rounded-full bg-white/5 px-3 py-1.5">{interviewBrief.tone}</span>
                  <span className="rounded-full bg-white/5 px-3 py-1.5">{interviewBrief.greetingLine}</span>
                </div>
              </div>
            ) : (
              <div className="max-w-3xl rounded-3xl border border-white/10 bg-white/[0.035] p-6">
                <p className="text-sm leading-6 text-gray-300">예: “따뜻한 오후의 거실에서 크림색 시바견 루이가 카메라를 바라보는 20초 브랜드 필름을 만들어줘.”</p>
              </div>
            )}
          </div>

          <form onSubmit={compose} className="sticky bottom-0 mt-8 rounded-3xl border border-white/15 bg-[#17151d]/95 p-3 shadow-2xl backdrop-blur">
            <label htmlFor="video-concept" className="sr-only">영상 콘셉트</label>
            <textarea id="video-concept" name="videoConcept" value={sentence} onChange={(event) => setSentence(event.target.value)} rows={3} placeholder="만들고 싶은 영상을 설명해 주세요…" className="w-full resize-none rounded-2xl bg-transparent px-4 py-3 text-base leading-6 text-white placeholder:text-gray-500 focus-visible:outline-none" disabled={isComposing}/>
            <div className="flex items-center justify-between gap-4 px-2 pb-1">
              <p aria-live="polite" className={`text-xs ${composeError ? 'text-red-300' : 'text-gray-500'}`}>{composeError ?? (isComposing ? 'AI가 기획을 구성하고 있습니다…' : '입력한 문장은 프로젝트 기획 데이터로 저장됩니다.')}</p>
              <button type="submit" disabled={!sentence.trim() || isComposing} className="rounded-xl bg-fuchsia-500 px-5 py-2.5 text-sm font-black text-white hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300">{isComposing ? '기획 중…' : 'AI 기획 시작'}</button>
            </div>
          </form>
        </div>
      </section>
    );
  }

  if (workspace === 'reference') {
    const displayed = characterSheet ?? (sampleMode ? SAMPLE_CHARACTER : undefined);
    return (
      <section className="h-full overflow-y-auto bg-[#0c0b10] p-6 lg:p-10">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-fuchsia-300">2 · 기준 시트</p>
          <h1 className="mt-2 text-3xl font-black text-white">캐릭터 기준을 고정합니다</h1>
          <p className="mt-2 text-sm text-gray-400">프로젝트에 등록된 기준 자산만 승인과 생성 입력에 포함됩니다.</p>
          {!displayed ? <div className="mt-8"><EmptyState title="기준 시트가 없습니다" description="인터뷰에서 AI 기획을 완료하거나 기준 자산을 업로드하세요. 관련 없는 예시 이미지는 자동으로 표시하지 않습니다."/></div> : (
            <div className="mt-8 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
              <article className="overflow-hidden rounded-3xl border border-white/10 bg-[#15131a]">
                {sampleMode ? <><div className="border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-bold text-amber-200">샘플 전용 · 현재 프로젝트의 승인 대상이 아닙니다</div><div className="relative aspect-[16/10] bg-black"><Image src="/mock-assets/reference-shiba.webp" alt="샘플 시바견 마스터 시트" fill className="object-contain" sizes="70vw" priority/></div></> : <div className="flex aspect-[16/10] flex-col items-center justify-center border-b border-dashed border-white/10 bg-black/40 px-8 text-center"><p className="text-base font-black text-white">기준 이미지 미등록</p><p className="mt-2 max-w-md text-sm leading-6 text-gray-500">AI가 생성한 캐릭터 텍스트만 저장됐습니다. 이미지를 등록하기 전까지 시각 자료는 승인 대상에 포함되지 않습니다.</p></div>}
              </article>
              <aside className="rounded-3xl border border-white/10 bg-[#15131a] p-6">
                <h2 className="text-xl font-black text-white">{displayed.name}</h2>
                <p className="mt-1 text-sm text-gray-400">{displayed.breed ?? '캐릭터 기준'}</p>
                <div className="mt-5 flex flex-wrap gap-2">{displayed.visualTags.map((tag) => <span key={tag} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-300">{tag}</span>)}</div>
                <div className="mt-8 space-y-3">{Object.entries(displayed.palette).map(([label, color]) => <div key={label} className="flex items-center gap-3"><span className="h-9 w-9 rounded-xl border border-white/10" style={{backgroundColor: color}}/><span className="text-sm text-gray-300">{label}</span><code className="ml-auto text-xs text-gray-500">{color}</code></div>)}</div>
              </aside>
            </div>
          )}
        </div>
      </section>
    );
  }

  if (workspace === 'storyboard') {
    const cuts = storyboard?.cuts ?? (sampleMode ? SAMPLE_CUTS : []);
    return (
      <section className="h-full overflow-y-auto bg-[#0c0b10] p-6 lg:p-10">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-fuchsia-300">3 · 스토리보드</p>
          <h1 className="mt-2 text-3xl font-black text-white">장면의 흐름을 검수합니다</h1>
          <p className="mt-2 text-sm text-gray-400">이미지가 없는 실제 컷에는 빈 상태를 표시합니다. 샘플 이미지는 승인 해시에 포함되지 않습니다.</p>
          {!cuts.length ? <div className="mt-8"><EmptyState title="스토리보드가 없습니다" description="인터뷰에서 AI 기획을 완료하면 컷 구조가 생성됩니다. 이미지 콘티는 이후 각 컷에 정식 자산으로 연결합니다."/></div> : (
            <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {cuts.map((cut, index) => {
                const action = 'action' in cut ? cut.action : cut.shots.map((shot) => shot.action).join(' · ');
                const start = 'start' in cut ? cut.start : cut.absoluteStartSeconds;
                const end = 'end' in cut ? cut.end : cut.absoluteEndSeconds;
                return <article key={cut.id} className="overflow-hidden rounded-3xl border border-white/10 bg-[#15131a]">
                  {sampleMode && !storyboard ? <div className="relative aspect-video bg-black"><Image src={`/mock-assets/story-0${(index % 3) + 1}.webp`} alt={`샘플 장면 ${index + 1}`} fill className="object-cover" sizes="25vw"/><span className="absolute left-3 top-3 rounded-full bg-amber-400 px-2 py-1 text-[11px] font-black text-black">샘플 · 승인 제외</span></div> : <div className="flex aspect-video items-center justify-center border-b border-dashed border-white/10 bg-black/40 px-5 text-center text-sm text-gray-500">이미지 콘티 미생성</div>}
                  <div className="p-5"><div className="flex items-center justify-between text-xs text-fuchsia-300"><span className="font-black">{cut.id}</span><span className="tabular-nums">{start}–{end}초</span></div><h2 className="mt-3 text-lg font-black text-white">{cut.title}</h2><p className="mt-2 line-clamp-3 text-sm leading-6 text-gray-400">{action}</p></div>
                </article>;
              })}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (workspace === 'generation') {
    return (
      <section className="h-full overflow-y-auto bg-[#0c0b10] p-6 lg:p-10">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-fuchsia-300">4 · 영상 생성</p>
          <h1 className="mt-2 text-3xl font-black text-white">승인된 입력만 생성합니다</h1>
          <p className="mt-2 text-sm text-gray-400">화면에 보이는 자산과 승인 해시가 일치해야 유료 제출을 열 수 있습니다.</p>
          {sampleMode ? <div className="mt-8 grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
            <article className="overflow-hidden rounded-3xl border border-white/10 bg-black"><div className="border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-bold text-amber-200">샘플 결과 · 생성 결과 및 승인 대상 아님</div><div className="flex aspect-video items-center justify-center"><video className="h-full w-full object-contain" src="/mock-assets/sample-video-web.mp4" poster="/mock-assets/video-poster.webp" controls muted playsInline preload="metadata"/></div></article>
            <aside className="space-y-4"><div className="rounded-3xl border border-white/10 bg-[#15131a] p-6"><h2 className="font-black text-white">현재 상태</h2><p className="mt-3 text-sm leading-6 text-gray-400">샘플 자산은 프로젝트 자산 ID와 해시가 없어 승인할 수 없습니다.</p></div><div className="rounded-3xl border border-red-400/20 bg-red-400/[0.06] p-6"><p className="text-sm font-black text-red-200">유료 제출 잠김</p><p className="mt-2 text-sm leading-6 text-red-100/70">정식 자산 연결·Creative 승인·생성 승인이 완료돼야 합니다.</p></div></aside>
          </div> : <div className="mt-8"><EmptyState title="승인 가능한 생성본이 없습니다" description="기준 시트와 스토리보드의 정식 자산 연결을 완료한 뒤 생성 승인을 진행하세요. 샘플 영상은 자동으로 표시하지 않습니다."/></div>}
        </div>
      </section>
    );
  }

  return (
    <section className="h-full overflow-y-auto bg-[#0c0b10] p-6 lg:p-10">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-fuchsia-300">5 · 편집</p>
        <h1 className="mt-2 text-3xl font-black text-white">생성본을 타임라인에서 완성합니다</h1>
        <div className="mt-8"><EmptyState title="편집할 프로젝트 미디어가 없습니다" description="생성 완료된 take 또는 업로드한 미디어를 타임라인에 추가하세요. 샘플 미디어는 정식 클립으로 가장하지 않습니다." action={<button type="button" onClick={onOpenEdit} className="rounded-xl bg-white px-5 py-2.5 text-sm font-black text-black hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">편집기 열기</button>}/></div>
      </div>
    </section>
  );
}
