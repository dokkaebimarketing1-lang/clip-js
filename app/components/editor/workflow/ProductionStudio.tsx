'use client';

import Image from 'next/image';
import {useEffect, useMemo, useRef, useState} from 'react';
import {store, useAppDispatch, useAppSelector} from '@/app/store';
import {installCreativeApprovalIfCurrent, setMediaFiles, setWorkflow} from '@/app/store/slices/projectSlice';
import {attachCutFrameAsset, reorderStoryboardCuts, selectTakeForTimeline} from '@/app/lib/workflow/project-production';
import {invalidateForCreativeChange} from '@/app/lib/workflow/approval';
import {creativeApprovalSchema, storyboardCutSchema, type CharacterSheet, type Storyboard, type StoryboardCut} from '@/app/lib/workflow/schema';
import {prepareCreativeApprovalCommand, staleCreativeApprovalMessage} from '@/app/lib/workflow/creative-approval-apply';
import {deriveGenerationPreflight} from '@/app/lib/workflow/generation-preflight';
import {deriveStageStepStates, type StageStepState} from '@/app/lib/editor/stage-status';
import {takeApprovalSchema} from '@/app/lib/workflow/production-schema';

const sha256 = async (file: File) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map((byte) => byte.toString(16).padStart(2, '0')).join('');

const useAssetPreview = (projectId: string, assetId?: string) => {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    if (!assetId) return;
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/ui-capability`, {method: 'POST'})
      .then(async (response) => {
        const payload = await response.json() as {url?: string};
        if (!response.ok || !payload.url) throw new Error();
        if (!cancelled) setUrl(payload.url);
      }).catch(() => { if (!cancelled) setUrl(undefined); });
    return () => { cancelled = true; };
  }, [projectId, assetId]);
  return url;
};

function FrameUpload({projectId, cutId, role, assetId}: {projectId: string; cutId: string; role: 'start' | 'end'; assetId?: string}) {
  const dispatch = useAppDispatch();
  const project = useAppSelector((state) => state.projectState);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const previewUrl = useAssetPreview(projectId, assetId);

  const upload = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true); setError(undefined);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('PNG·JPG·WebP 이미지만 20MB까지 업로드할 수 있습니다.');
      const hash = await sha256(file);
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets/ui-upload`, {
        method: 'POST',
        headers: {'content-type': file.type, 'x-clipjs-media-id': `${cutId}-${role}`, 'x-clipjs-content-sha256': hash},
        body: file,
      });
      const payload = await response.json() as {assetId?: string; contentSha256?: string; error?: string};
      if (!response.ok || !payload.assetId || payload.contentSha256 !== hash) throw new Error(payload.error ?? '이미지 등록에 실패했습니다.');
      const next = attachCutFrameAsset(project, {cutId, role, assetId: payload.assetId, contentSha256: hash, fileName: file.name});
      dispatch(setWorkflow(next.workflow));
      dispatch(setMediaFiles(next.mediaFiles));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '이미지 등록에 실패했습니다.'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };

  return <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
    <button type="button" onClick={() => input.current?.click()} className="group relative flex aspect-video w-full items-center justify-center overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fuchsia-400">
      {previewUrl ? <Image src={previewUrl} alt={`${cutId} ${role === 'start' ? '시작' : '끝'} 프레임`} fill unoptimized className="object-cover" sizes="25vw"/> : <span className="text-xs font-bold text-gray-500">{busy ? '검증·등록 중…' : `${role === 'start' ? '시작' : '끝'} 프레임 업로드`}</span>}
      {previewUrl ? <span className="absolute inset-x-0 bottom-0 bg-black/75 px-3 py-2 text-xs font-bold text-white opacity-0 transition group-hover:opacity-100">이미지 교체</span> : null}
    </button>
    <input ref={input} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void upload(event.target.files?.[0])}/>
    <div className="flex items-center justify-between px-3 py-2 text-[11px]"><span className="font-bold text-gray-300">{role === 'start' ? 'START' : 'END'}</span><span className={assetId ? 'text-emerald-300' : 'text-gray-600'}>{assetId ? '정식 자산' : '미등록'}</span></div>
    {error ? <p role="alert" className="px-3 pb-2 text-[11px] text-red-300">{error}</p> : null}
  </div>;
}

function CutPreview({projectId, cut, selected}: {projectId: string; cut: StoryboardCut; selected: boolean}) {
  const previewUrl = useAssetPreview(projectId, cut.previewAssetId ?? cut.startFrameAssetId);
  const firstShot = cut.shots[0];
  return <div className={`relative aspect-video overflow-hidden rounded-xl border ${selected ? 'border-fuchsia-300/70' : 'border-white/10'} bg-[radial-gradient(circle_at_20%_20%,rgba(217,70,239,.15),transparent_38%),linear-gradient(145deg,#181421,#09080d)]`}>
    {previewUrl ? <Image src={previewUrl} alt={`${cut.title} 대표 프레임`} fill unoptimized className="object-cover" sizes="240px"/> : <div className="absolute inset-0 flex items-end p-3"><p className="line-clamp-3 text-[11px] font-medium leading-4 text-gray-400">{firstShot?.startFrame ?? '대표 프레임 미등록'}</p></div>}
    <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent p-2.5"><span className="rounded-md bg-black/70 px-2 py-1 text-[10px] font-black text-white">{cut.id}</span><span className="font-mono text-[10px] text-white/70">{cut.absoluteStartSeconds}–{cut.absoluteEndSeconds}s</span></div>
  </div>;
}

const ShotStateFrame = ({label, text, tone}: {label: 'START' | 'END'; text: string; tone: 'start' | 'end'}) => <div className={`min-h-24 rounded-xl border p-3 ${tone === 'start' ? 'border-sky-400/15 bg-sky-400/[0.045]' : 'border-fuchsia-400/15 bg-fuchsia-400/[0.045]'}`}><div className="flex items-center justify-between"><span className={`text-[10px] font-black tracking-[0.16em] ${tone === 'start' ? 'text-sky-300' : 'text-fuchsia-300'}`}>{label}</span><span className="text-[9px] text-gray-600">{tone === 'start' ? '시작 상태' : '종료 상태'}</span></div><p className="mt-3 text-xs font-medium leading-5 text-gray-200">{text}</p></div>;

export function StoryboardStudio({storyboard, characterSheets = [], reviewOnly = false}: {storyboard: Storyboard; characterSheets?: CharacterSheet[]; reviewOnly?: boolean}) {
  const dispatch = useAppDispatch();
  const project = useAppSelector((state) => state.projectState);
  const imageGenerationEnabled = process.env.NEXT_PUBLIC_CLIPJS_IMAGE_GENERATION_ENABLED === 'true';
  const [draggedId, setDraggedId] = useState<string>();
  const [selectedCutId, setSelectedCutId] = useState(storyboard.cuts[0]?.id ?? '');
  const [instruction, setInstruction] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState(false);
  const [previewCut, setPreviewCut] = useState<StoryboardCut>();
  const [isApproving, setIsApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const selected = storyboard.cuts.find((cut) => cut.id === selectedCutId) ?? storyboard.cuts[0];

  const reorder = (targetId: string) => {
    if (reviewOnly) return;
    if (!draggedId || draggedId === targetId) return;
    const ids = storyboard.cuts.map((cut) => cut.id);
    const from = ids.indexOf(draggedId); const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    const next = reorderStoryboardCuts(project, ids);
    dispatch(setWorkflow(next.workflow));
    dispatch(setMediaFiles(next.mediaFiles));
    setDraggedId(undefined);
  };

  const applyEdit = async () => {
    if (reviewOnly) return;
    if (!selected || !instruction.trim()) return;
    setEditing(true); setMessage('DeepSeek가 선택 컷을 수정하고 있습니다.');
    try {
      const response = await fetch('/api/vlog/cut-edit', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({cut: selected, instruction})});
      const payload = await response.json() as {cut?: unknown; error?: string};
      if (!response.ok || !payload.cut) throw new Error(payload.error ?? 'AI 컷 수정을 완료하지 못했습니다.');
      const edited = storyboardCutSchema.parse(payload.cut);
      setPreviewCut({...edited, characterIds: selected.characterIds, startFrameAssetId: selected.startFrameAssetId, endFrameAssetId: selected.endFrameAssetId, previewAssetId: selected.previewAssetId, generatedTakeIds: selected.generatedTakeIds});
      setMessage('수정 미리보기를 확인한 뒤 적용하세요. 프로젝트는 아직 변경되지 않았습니다.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '수정 요청을 적용하지 못했습니다.'); }
    finally { setEditing(false); }
  };

  const commitPreview = () => {
    if (!previewCut || !selected) return;
    const nextStoryboard = {...project.workflow.storyboard!, cuts: project.workflow.storyboard!.cuts.map((cut) => cut.id === selected.id ? previewCut : cut)};
    dispatch(setWorkflow(invalidateForCreativeChange({...project.workflow, storyboard: nextStoryboard})));
    setPreviewCut(undefined); setInstruction(''); setMessage('수정 결과를 적용했고 기존 승인을 무효화했습니다.');
  };

  const approveCurrentStoryboard = async () => {
    if (reviewOnly) return;
    if (isApproving) return;
    const requestStoryboard = storyboard;
    const requestCharacterSheets = characterSheets;
    setIsApproving(true);
    setApprovalError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/creative-approval/ui`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({storyboard: requestStoryboard, characterSheets: requestCharacterSheets}),
      });
      const payload = await response.json() as {creativeApproval?: unknown; error?: string};
      if (!response.ok || !payload.creativeApproval) throw new Error(payload.error ?? '스토리보드를 확정하지 못했습니다.');
      const creativeApproval = creativeApprovalSchema.parse(payload.creativeApproval);
      const command = await prepareCreativeApprovalCommand(requestStoryboard, requestCharacterSheets, creativeApproval);
      dispatch(installCreativeApprovalIfCurrent(command));
      const installed = store.getState().projectState.workflow.creativeApproval;
      if (installed.status !== 'approved' || installed.signature !== creativeApproval.signature) throw new Error(staleCreativeApprovalMessage);
      setMessage('현재 스토리보드를 Creative 기준으로 확정했습니다. 이후 컷이나 기준 이미지를 바꾸면 승인이 자동 취소됩니다.');
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : '스토리보드를 확정하지 못했습니다.');
    } finally {
      setIsApproving(false);
    }
  };

  const creativeApproved = project.workflow.creativeApproval.status === 'approved';
  const missingFrameCount = storyboard.cuts.filter((cut) => !cut.startFrameAssetId || !cut.endFrameAssetId).length;
  const selectedIndex = storyboard.cuts.findIndex((cut) => cut.id === selected?.id);
  const nextCut = selectedIndex >= 0 ? storyboard.cuts[selectedIndex + 1] : undefined;
  const directorIntent = selected?.shots.map((shot) => shot.action).filter(Boolean).join(' → ') ?? '';

  if (!selected) return null;

  return <div className="mt-6 space-y-5">
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#111016]">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
        <div><div className="flex items-center gap-2"><span className="rounded-full bg-fuchsia-400/10 px-2.5 py-1 text-[10px] font-black tracking-[0.14em] text-fuchsia-300">STORY FLOW</span><span className="text-xs text-gray-500">전체 영상 흐름</span></div><h2 className="mt-2 text-lg font-black text-white">{storyboard.title}</h2><p className="mt-1 text-xs text-gray-500">컷을 선택하면 아래에서 샷별 시작·끝 상태와 연출을 정밀 검수할 수 있습니다.</p></div>
        <div className="flex items-center gap-2 text-xs"><span className="rounded-full bg-white/5 px-3 py-1.5 text-gray-300">{storyboard.cuts.length} CUTS</span><span className="rounded-full bg-white/5 px-3 py-1.5 text-gray-300">{storyboard.cuts.reduce((sum, cut) => sum + cut.shots.length, 0)} SHOTS</span><span className="rounded-full bg-sky-400/10 px-3 py-1.5 font-bold text-sky-300">{storyboard.noBgm ? 'NO BGM' : '오디오 포함'}</span></div>
      </header>
      <div className="flex gap-3 overflow-x-auto p-4 [scrollbar-color:#3f3a49_transparent]">{storyboard.cuts.map((cut) => <button key={cut.id} type="button" draggable={!reviewOnly} onDragStart={() => { if (!reviewOnly) setDraggedId(cut.id); }} onDragOver={(event) => event.preventDefault()} onDrop={() => reorder(cut.id)} onClick={() => setSelectedCutId(cut.id)} className={`w-52 shrink-0 rounded-2xl p-2 text-left transition ${selected.id === cut.id ? 'bg-fuchsia-400/10 ring-1 ring-fuchsia-400/40' : 'bg-white/[0.025] hover:bg-white/[0.05]'}`}><CutPreview projectId={project.id} cut={cut} selected={selected.id === cut.id}/><div className="px-1 pb-1 pt-3"><p className="truncate text-xs font-black text-white">{cut.title}</p><p className="mt-1 text-[10px] text-gray-500">{cut.shots.length}개 샷 · {reviewOnly ? '선택해 상세 검수' : '드래그해 순서 변경'}</p></div></button>)}</div>
    </section>

    <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_300px]">
      <main className="min-w-0 overflow-hidden rounded-3xl border border-white/10 bg-[#0d0c12]">
        <header className="border-b border-white/10 px-5 py-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><span className="text-xs font-black text-fuchsia-300">{selected.id}</span><span className="font-mono text-[11px] text-gray-600">{selected.absoluteStartSeconds.toFixed(1)}–{selected.absoluteEndSeconds.toFixed(1)}s</span></div><h2 className="mt-2 text-2xl font-black tracking-tight text-white">{selected.title}</h2></div><div className="flex flex-wrap gap-2">{selected.characterIds?.map((characterId) => { const character = characterSheets.find((sheet) => sheet.id === characterId); return <span key={characterId} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-bold text-gray-300">{character?.name ?? characterId}</span>; })}</div></div><div className="mt-4 flex flex-wrap items-center gap-3 text-xs"><span className="rounded-lg bg-fuchsia-400/10 px-2.5 py-1.5 font-black text-fuchsia-200">SHOT BREAKDOWN</span><span className="text-gray-500">한 컷을 {selected.shots.length}개 앵글로 분해한 정밀 콘티</span></div></header>

        <div className="divide-y divide-white/[0.07]">{selected.shots.map((shot, shotIndex) => <article key={shot.id} className="grid gap-4 px-5 py-5 lg:grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)_240px]">
          <div><p className="text-sm font-black text-white">S{shotIndex + 1}</p><p className="mt-1 font-mono text-[10px] text-gray-500">{shot.startSeconds.toFixed(1)}–{shot.endSeconds.toFixed(1)}s</p><div className="mt-3 h-1 overflow-hidden rounded-full bg-white/5"><div className="h-full bg-fuchsia-400" style={{width: `${Math.min(100, ((shot.endSeconds - shot.startSeconds) / Math.max(0.1, selected.absoluteEndSeconds - selected.absoluteStartSeconds)) * 100)}%`}}/></div></div>
          <ShotStateFrame label="START" text={shot.startFrame} tone="start"/>
          <ShotStateFrame label="END" text={shot.endFrame} tone="end"/>
          <div className="space-y-3"><div><p className="text-[9px] font-black tracking-[0.15em] text-gray-600">CAMERA / MOVEMENT</p><p className="mt-1 text-xs font-bold leading-5 text-white">{shot.camera}</p></div><div><p className="text-[9px] font-black tracking-[0.15em] text-gray-600">ACTION</p><p className="mt-1 text-xs leading-5 text-gray-300">{shot.action}</p></div><div><p className="text-[9px] font-black tracking-[0.15em] text-amber-400/60">DIALOGUE</p><p className="mt-1 text-xs font-bold leading-5 text-amber-100">{shot.dialogue && shot.dialogue !== '—' ? `“${shot.dialogue}”` : '—'}</p></div>{shot.sfx && shot.sfx !== '—' ? <div><p className="text-[9px] font-black tracking-[0.15em] text-sky-400/60">SFX</p><p className="mt-1 text-xs leading-5 text-sky-100">{shot.sfx}</p></div> : null}</div>
        </article>)}</div>

        <footer className="grid border-t border-white/10 md:grid-cols-2"><div className="border-b border-white/10 p-5 md:border-b-0 md:border-r"><p className="text-[10px] font-black tracking-[0.16em] text-fuchsia-300">DIRECTOR&apos;S INTENT</p><p className="mt-2 text-xs leading-6 text-gray-300">{directorIntent || '이 컷의 행동 흐름을 확인하세요.'}</p><p className="mt-2 text-[10px] text-gray-600">현재 컷의 행동에서 요약 · AI 창작 메모 아님</p></div><div className="p-5"><p className="text-[10px] font-black tracking-[0.16em] text-sky-300">TRANSITION</p><p className="mt-2 text-xs leading-6 text-gray-300">{nextCut ? `${selected.shots.at(-1)?.endFrame ?? '현재 컷 종료'} → ${nextCut.title}의 ${nextCut.shots[0]?.startFrame ?? '시작 상태'}` : '마지막 컷 · 영상 종료 상태를 확인하세요.'}</p></div></footer>

        <details className="border-t border-white/10 bg-white/[0.02] px-5 py-4"><summary className="cursor-pointer text-xs font-black text-gray-300">영상 생성용 이미지 준비 <span className="ml-2 font-normal text-gray-600">콘티 승인 후 START/END 프레임 등록</span></summary><p className="mt-2 max-w-3xl text-xs leading-5 text-gray-500">위 START/END는 샷의 이야기 상태입니다. 아래 이미지는 승인된 연출을 Seedance가 같은 시작과 끝으로 구현하도록 고정하는 정식 자산입니다.</p>{reviewOnly ? <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs leading-5 text-amber-100">샘플 검토 모드에서는 이미지를 업로드하거나 프로젝트 데이터를 변경하지 않습니다.</div> : <><div className="mt-4 grid max-w-2xl grid-cols-2 gap-3"><FrameUpload projectId={project.id} cutId={selected.id} role="start" assetId={selected.startFrameAssetId}/><FrameUpload projectId={project.id} cutId={selected.id} role="end" assetId={selected.endFrameAssetId}/></div><button type="button" disabled={!imageGenerationEnabled} title={imageGenerationEnabled ? '선택 컷의 시작·끝 프레임을 생성합니다.' : '이미지 생성 모델과 유료 제출이 서버에서 비활성화되어 있습니다.'} className="mt-3 rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-gray-400 disabled:cursor-not-allowed disabled:opacity-50">{imageGenerationEnabled ? 'AI 시작·끝 프레임 생성' : 'AI 이미지 생성 잠김'}</button></>}</details>
      </main>

      <aside className="rounded-3xl border border-white/10 bg-[#15131a] p-5 2xl:sticky 2xl:top-4"><p className="text-[10px] font-black tracking-[0.16em] text-fuchsia-300">SELECTED CUT</p><h3 className="mt-2 text-lg font-black text-white">{selected.id} · {selected.title}</h3><p className="mt-2 text-xs leading-5 text-gray-500">이 컷에서 바꾸고 싶은 내용을 평소 말하듯 입력하세요. 먼저 미리보기만 만들며 자동 적용되지 않습니다.</p><textarea value={instruction} disabled={reviewOnly} onChange={(event) => setInstruction(event.target.value)} rows={6} placeholder="예: S2를 인물 표정 클로즈업으로 바꾸고, 마지막 대사는 그대로 유지해줘" className="mt-4 w-full resize-none rounded-2xl border border-white/10 bg-black/30 p-3 text-sm leading-6 text-white placeholder:text-gray-600 focus:border-fuchsia-400 focus:outline-none"/><button type="button" onClick={() => void applyEdit()} disabled={reviewOnly || editing || !instruction.trim()} className="mt-3 w-full rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-black text-white hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-50">{editing ? '수정안 만드는 중…' : 'AI 수정안 미리보기'}</button>{previewCut ? <div className="mt-4 rounded-2xl border border-fuchsia-400/30 bg-fuchsia-400/[0.07] p-4"><p className="text-[10px] font-black text-fuchsia-300">적용 전 변경안</p><p className="mt-2 text-sm font-black text-white">{previewCut.title}</p><p className="mt-2 text-xs leading-5 text-gray-400">{previewCut.shots.map((shot) => shot.action).join(' · ')}</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => setPreviewCut(undefined)} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-gray-400">취소</button><button type="button" onClick={commitPreview} className="rounded-lg bg-fuchsia-500 px-3 py-2 text-xs font-black text-white">변경안 적용</button></div></div> : null}<p aria-live="polite" className="mt-3 text-xs leading-5 text-gray-500">{message || (reviewOnly ? '전체 흐름에서 컷을 선택해 샷별 연출을 검수할 수 있습니다.' : '전체 흐름에서 컷을 선택하거나 드래그해 순서를 바꿀 수 있습니다.')}</p></aside>
    </div>

    <section className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border px-5 py-4 shadow-2xl backdrop-blur-xl ${creativeApproved ? 'border-emerald-400/30 bg-[#10201b]/95' : 'border-amber-300/25 bg-[#191711]/95'}`}><div><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${creativeApproved ? 'bg-emerald-400' : 'bg-amber-300'}`}/><p className={`text-sm font-black ${creativeApproved ? 'text-emerald-200' : 'text-white'}`}>{reviewOnly ? '샘플 검토 모드 · 실제 프로젝트 승인과 분리' : creativeApproved ? '현재 콘티 버전 승인 완료' : '전체 흐름과 선택 컷을 모두 확인했나요?'}</p></div><p className="mt-1 text-xs text-gray-400">{storyboard.cuts.length}개 컷 · {storyboard.cuts.reduce((sum, cut) => sum + cut.shots.length, 0)}개 샷 · 생성용 이미지 미완료 {missingFrameCount}개</p></div>{reviewOnly ? <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-4 py-2 text-xs font-black text-amber-100">승인 제외</span> : creativeApproved ? <span className="rounded-full bg-emerald-400/10 px-3 py-1.5 text-xs font-black text-emerald-300">Creative locked</span> : <button type="button" disabled={isApproving || Boolean(previewCut)} onClick={() => void approveCurrentStoryboard()} className="rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-black shadow-[0_8px_30px_rgba(52,211,153,.2)] disabled:cursor-not-allowed disabled:opacity-40">{isApproving ? '현재 버전 잠그는 중…' : '검수 완료 · 현재 콘티 승인'}</button>}{previewCut ? <p className="basis-full text-[11px] text-amber-200">수정 미리보기를 적용하거나 취소한 뒤 승인할 수 있습니다.</p> : null}{approvalError ? <p role="alert" className="basis-full text-xs text-red-300">{approvalError}</p> : null}</section>
  </div>;
}
const TakeVideo = ({projectId, assetId, label}: {projectId: string; assetId?: string; label: string}) => {
  const url = useAssetPreview(projectId, assetId);
  return <div className="flex aspect-video items-center justify-center overflow-hidden rounded-2xl bg-black">{url ? <video src={url} controls muted playsInline className="h-full w-full object-contain"/> : <span className="text-sm text-gray-600">{label} 미리보기 없음</span>}</div>;
};

const GenerationPreflightPanel = ({preflight}: {preflight: ReturnType<typeof deriveGenerationPreflight>}) => (
  <section className="rounded-3xl border border-white/10 bg-[#15131a] p-6 text-left">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-black uppercase tracking-[0.16em] text-fuchsia-300">생성 전 사전점검</p><h2 className="mt-2 text-xl font-black text-white">{preflight.readyForAuthorization ? '승인 요청 준비 완료' : '생성 전에 보완이 필요합니다'}</h2></div>
      <span className="flex flex-wrap items-center justify-end gap-2"><span className="rounded-full bg-red-400/10 px-3 py-1.5 text-xs font-black text-red-200">유료 제출 잠금</span><span className={`rounded-full px-3 py-1.5 text-xs font-black ${preflight.readyForAuthorization ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-200'}`}>{preflight.checks.filter((check) => check.passed).length}/{preflight.checks.length} 통과</span></span>
    </div>
    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">{preflight.checks.map((check) => <article key={check.id} className={`rounded-2xl border p-4 ${check.passed ? 'border-emerald-400/20 bg-emerald-400/[0.05]' : 'border-amber-400/20 bg-amber-400/[0.05]'}`}><p className={`text-xs font-black ${check.passed ? 'text-emerald-300' : 'text-amber-200'}`}>{check.passed ? '✓' : '!'} {check.label}</p><p className="mt-2 text-xs leading-5 text-gray-400">{check.detail}</p></article>)}</div>
    <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-red-400/20 bg-red-400/[0.05] px-4 py-3"><div><p className="text-xs font-black text-red-200">유료 제출 잠금 유지</p><p className="mt-1 text-xs text-red-100/60">사전점검은 과금하거나 Seedance 작업을 생성하지 않습니다.</p></div><code className="text-[11px] text-red-200/70">SUBMIT=false</code></div>
  </section>
);

const GenerationQuotePanel = ({duration, resolution, generateAudio, shotCount}: {duration: number; resolution: string; generateAudio: boolean; shotCount: number}) => (
  <section className="rounded-3xl border border-amber-400/25 bg-amber-400/[0.05] p-6 text-left">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-amber-200">유료 생성 명세</p><h2 className="mt-2 text-xl font-black text-white">비용 견적 확인 전에는 승인할 수 없습니다</h2></div><span className="rounded-full bg-amber-300 px-3 py-1.5 text-xs font-black text-black">견적 대기</span></div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><div className="rounded-2xl bg-black/20 p-4"><p className="text-xs text-gray-500">모델</p><p className="mt-1 break-all text-sm font-black text-white">dreamina-seedance-2-5-260628</p></div><div className="rounded-2xl bg-black/20 p-4"><p className="text-xs text-gray-500">길이</p><p className="mt-1 text-sm font-black text-white">{duration}초</p></div><div className="rounded-2xl bg-black/20 p-4"><p className="text-xs text-gray-500">해상도</p><p className="mt-1 text-sm font-black uppercase text-white">{resolution}</p></div><div className="rounded-2xl bg-black/20 p-4"><p className="text-xs text-gray-500">오디오 생성</p><p className="mt-1 text-sm font-black text-white">{generateAudio ? '포함' : '미포함'}</p></div><div className="rounded-2xl bg-black/20 p-4"><p className="text-xs text-gray-500">승인 대상</p><p className="mt-1 text-sm font-black text-white">{shotCount}개 생성 명세</p></div></div>
    <p className="mt-4 text-sm leading-6 text-amber-100/70">Seedance 2.5는 resource pack과 token 차감 방식이며 해상도·입력 모드에 따라 사용량이 달라집니다. 현재 계정의 예상 차감량을 확인할 수 없어 비용 확인 체크와 생성 승인을 잠갔습니다.</p>
    <button type="button" disabled className="mt-4 w-full rounded-xl bg-white/10 px-4 py-3 text-sm font-black text-gray-500">정확한 비용 견적이 필요합니다</button>
  </section>
);

export function TakeStudio({reviewOnly = false}: {reviewOnly?: boolean} = {}) {
  const dispatch = useAppDispatch();
  const project = useAppSelector((state) => state.projectState);
  const [selectedShotId, setSelectedShotId] = useState(project.workflow.production.shotSpecs[0]?.id ?? '');
  const [viewTakeId, setViewTakeId] = useState<string>();
  const [qcBusy, setQcBusy] = useState(false);
  const [qcError, setQcError] = useState<string>();
  const [stageResult, setStageResult] = useState<{project: typeof project; states: Record<string, StageStepState>} | null>(null);
  const takes = useMemo(() => project.workflow.production.takes.filter((take) => take.scope === 'shot' ? take.shotSpecId === selectedShotId : true), [project.workflow.production.takes, selectedShotId]);
  const current = takes.find((take) => take.id === viewTakeId) ?? takes.find((take) => take.selected) ?? takes[0];
  const compare = takes.filter((take) => take.outputAssetId).slice(0, 2);
  useEffect(() => {
    let current = true;
    void deriveStageStepStates({workspace: 'generation', project, hasSubmittedGeneration: false}).then((states) => {
      if (current) setStageResult({project, states});
    });
    return () => { current = false; };
  }, [project]);
  const currentStates = stageResult?.project === project ? stageResult.states : null;
  const preflight = useMemo(() => deriveGenerationPreflight(project, false, {
    storyboardCurrent: currentStates?.storyboard === 'complete',
    creativeApprovalCurrent: currentStates?.['creative-approval'] === 'complete',
  }), [currentStates, project]);
  const choose = (takeId: string) => { if (reviewOnly) return; const next = selectTakeForTimeline(project, takeId); dispatch(setWorkflow(next.workflow)); dispatch(setMediaFiles(next.mediaFiles)); setViewTakeId(takeId); };
  const decideTake = async (decision: 'approved' | 'rejected') => {
    if (reviewOnly || !current || qcBusy) return;
    setQcBusy(true); setQcError(undefined);
    try {
      let takeApproval = current.takeApproval;
      if (decision === 'approved') {
        if (!current.requestKey || !current.outputAssetId || !current.contentSha256) throw new Error('서버 검증에 필요한 생성본 ID와 해시가 없습니다.');
        const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/takes/${encodeURIComponent(current.id)}/approve/ui`, {
          method: 'POST', headers: {'content-type': 'application/json'},
          body: JSON.stringify({requestKey: current.requestKey, assetId: current.outputAssetId, contentSha256: current.contentSha256}),
        });
        const payload = await response.json() as {takeApproval?: unknown; error?: string};
        if (!response.ok || !payload.takeApproval) throw new Error(payload.error ?? '생성본을 승인하지 못했습니다.');
        takeApproval = takeApprovalSchema.parse(payload.takeApproval);
      } else {
        takeApproval = takeApprovalSchema.parse({status: 'rejected', takeId: current.id, assetId: current.outputAssetId, contentSha256: current.contentSha256, approvedAt: new Date().toISOString(), approvedBy: 'project-owner'});
      }
      const takes = project.workflow.production.takes.map((take) => take.id === current.id ? {...take, qcStatus: decision, verdict: decision === 'approved' ? 'accepted' as const : 'rejected' as const, selected: decision === 'approved' ? take.selected : false, takeApproval} : take);
      dispatch(setWorkflow({...project.workflow, production: {...project.workflow.production, takes}}));
    } catch (error) { setQcError(error instanceof Error ? error.message : '생성본 검수 결과를 저장하지 못했습니다.'); }
    finally { setQcBusy(false); }
  };

  const quotePanel = <GenerationQuotePanel duration={project.workflow.seedanceMaster.duration} resolution={project.workflow.seedanceMaster.resolution} generateAudio={project.workflow.seedanceMaster.generateAudio} shotCount={project.workflow.production.shotSpecs.length}/>;
  if (!takes.length) return <div className="mt-8 space-y-5"><GenerationPreflightPanel preflight={preflight}/>{quotePanel}<div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.025] p-10 text-center"><h2 className="font-black text-white">저장된 take가 없습니다</h2><p className="mt-2 text-sm leading-6 text-gray-500">Seedance 결과가 secure ingest와 QC 승인을 통과하면 이곳에 실제 take로 저장됩니다. 유료 제출은 현재 잠겨 있습니다.</p></div></div>;
  return <div className="mt-8 space-y-5">
    <GenerationPreflightPanel preflight={preflight}/>
    {quotePanel}
    <div className="flex flex-wrap gap-2">{project.workflow.production.shotSpecs.map((spec) => <button key={spec.id} type="button" onClick={() => setSelectedShotId(spec.id)} className={`rounded-full px-4 py-2 text-xs font-bold ${selectedShotId === spec.id ? 'bg-fuchsia-500 text-white' : 'bg-white/5 text-gray-400'}`}>{spec.cutId} · {spec.shotId}</button>)}</div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div><TakeVideo projectId={project.id} assetId={current?.outputAssetId} label={current?.id ?? 'take'}/><div className="mt-3 flex flex-wrap gap-2">{takes.map((take) => <button key={take.id} type="button" onClick={() => setViewTakeId(take.id)} className={`rounded-xl border px-3 py-2 text-xs font-bold ${current?.id === take.id ? 'border-fuchsia-400 bg-fuchsia-400/10 text-fuchsia-200' : 'border-white/10 text-gray-400'}`}>{take.id}{take.selected ? ' · 타임라인' : ''}</button>)}</div></div>
      <aside className="rounded-3xl border border-white/10 bg-[#15131a] p-5"><p className="text-xs text-gray-500">현재 버전</p><h3 className="mt-2 break-all font-black text-white">{current?.id}</h3><p className="mt-3 text-xs text-gray-400">QC {current?.qcStatus} · {current?.resolution ?? '해상도 미상'}</p>{current?.qcStatus === 'qc_pending' ? <div className="mt-5"><p className="text-xs leading-5 text-gray-400">영상을 직접 재생해 캐릭터·동작·화풍을 확인한 뒤 결정하세요. 반려해도 자동 재생성·추가 과금은 없습니다.</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={reviewOnly || qcBusy} onClick={() => void decideTake('rejected')} className="rounded-xl border border-red-400/30 px-3 py-2.5 text-xs font-black text-red-200 disabled:opacity-40">이 버전 반려</button><button type="button" disabled={reviewOnly || qcBusy} onClick={() => void decideTake('approved')} className="rounded-xl bg-emerald-400 px-3 py-2.5 text-xs font-black text-black disabled:opacity-40">이 버전 승인</button></div>{qcError ? <p role="alert" className="mt-2 text-xs text-red-300">{qcError}</p> : null}</div> : null}{current ? <button type="button" onClick={() => choose(current.id)} disabled={reviewOnly || current.qcStatus !== 'approved'} className="mt-5 w-full rounded-xl bg-fuchsia-500 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40">{reviewOnly ? '샘플에서는 배치할 수 없습니다' : current.qcStatus === 'approved' ? '타임라인에 이 버전 배치' : current.qcStatus === 'rejected' ? '반려된 버전' : '승인 후 배치 가능'}</button> : null}</aside>
    </div>
    {compare.length === 2 ? <div><h3 className="mb-3 font-black text-white">A/B 나란히 비교</h3><div className="grid gap-4 md:grid-cols-2">{compare.map((take, index) => <div key={take.id}><TakeVideo projectId={project.id} assetId={take.outputAssetId} label={`버전 ${index ? 'B' : 'A'}`}/><p className="mt-2 text-xs text-gray-500">{index ? 'B' : 'A'} · {take.id}</p></div>)}</div></div> : null}
  </div>;
}
