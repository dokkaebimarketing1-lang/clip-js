'use client';

import Image from 'next/image';
import {useEffect, useMemo, useRef, useState} from 'react';
import {useAppDispatch, useAppSelector} from '@/app/store';
import {setMediaFiles, setWorkflow} from '@/app/store/slices/projectSlice';
import {attachCutFrameAsset, reorderStoryboardCuts, selectTakeForTimeline} from '@/app/lib/workflow/project-production';
import {invalidateForCreativeChange} from '@/app/lib/workflow/approval';
import {storyboardCutSchema, type Storyboard, type StoryboardCut} from '@/app/lib/workflow/schema';

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

export function StoryboardStudio({storyboard}: {storyboard: Storyboard}) {
  const dispatch = useAppDispatch();
  const project = useAppSelector((state) => state.projectState);
  const imageGenerationEnabled = process.env.NEXT_PUBLIC_CLIPJS_IMAGE_GENERATION_ENABLED === 'true';
  const [draggedId, setDraggedId] = useState<string>();
  const [selectedCutId, setSelectedCutId] = useState(storyboard.cuts[0]?.id ?? '');
  const [instruction, setInstruction] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState(false);
  const [previewCut, setPreviewCut] = useState<StoryboardCut>();
  const selected = storyboard.cuts.find((cut) => cut.id === selectedCutId) ?? storyboard.cuts[0];

  const reorder = (targetId: string) => {
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
    if (!selected || !instruction.trim()) return;
    setEditing(true); setMessage('DeepSeek가 선택 컷을 수정하고 있습니다.');
    try {
      const response = await fetch('/api/vlog/cut-edit', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({cut: selected, instruction})});
      const payload = await response.json() as {cut?: unknown; error?: string};
      if (!response.ok || !payload.cut) throw new Error(payload.error ?? 'AI 컷 수정을 완료하지 못했습니다.');
      const edited = storyboardCutSchema.parse(payload.cut);
      setPreviewCut({...edited, startFrameAssetId: selected.startFrameAssetId, endFrameAssetId: selected.endFrameAssetId, previewAssetId: selected.previewAssetId, generatedTakeIds: selected.generatedTakeIds});
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

  return <div className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
    <div className="grid gap-5 md:grid-cols-2">
      {storyboard.cuts.map((cut) => <article key={cut.id} draggable onDragStart={() => setDraggedId(cut.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => reorder(cut.id)} onClick={() => setSelectedCutId(cut.id)} className={`cursor-grab rounded-3xl border bg-[#15131a] p-4 transition ${selected?.id === cut.id ? 'border-fuchsia-400/60 shadow-[0_0_0_1px_rgba(217,70,239,.2)]' : 'border-white/10 hover:border-white/25'}`}>
        <div className="flex items-center justify-between text-xs"><span className="font-black text-fuchsia-300">⠿ {cut.id}</span><span className="tabular-nums text-gray-500">{cut.absoluteStartSeconds}–{cut.absoluteEndSeconds}초</span></div>
        <h2 className="mt-3 text-lg font-black text-white">{cut.title}</h2>
        <p className="mt-2 line-clamp-2 min-h-12 text-sm leading-6 text-gray-400">{cut.shots.map((shot) => shot.action).join(' · ')}</p>
        <div className="mt-4 grid grid-cols-2 gap-3"><FrameUpload projectId={project.id} cutId={cut.id} role="start" assetId={cut.startFrameAssetId}/><FrameUpload projectId={project.id} cutId={cut.id} role="end" assetId={cut.endFrameAssetId}/></div>
        <button type="button" disabled={!imageGenerationEnabled} title={imageGenerationEnabled ? '선택 컷의 시작·끝 프레임을 생성합니다.' : '이미지 생성 모델과 유료 제출이 서버에서 비활성화되어 있습니다.'} className="mt-3 w-full rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-gray-400 disabled:cursor-not-allowed disabled:opacity-50">{imageGenerationEnabled ? 'AI 시작·끝 프레임 생성' : 'AI 이미지 생성 잠김'}</button>
      </article>)}
    </div>
    <aside className="h-fit rounded-3xl border border-white/10 bg-[#15131a] p-5 xl:sticky xl:top-0">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-fuchsia-300">AI 컷 수정</p>
      <h3 className="mt-2 font-black text-white">{selected?.id} · {selected?.title}</h3>
      <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={5} placeholder="예: 제목을 따뜻한 첫인상으로 바꾸고, 루이가 카메라를 바라보게 해줘" className="mt-4 w-full resize-none rounded-2xl border border-white/10 bg-black/30 p-3 text-sm leading-6 text-white placeholder:text-gray-600 focus:border-fuchsia-400 focus:outline-none"/>
      <button type="button" onClick={() => void applyEdit()} disabled={editing || !instruction.trim()} className="mt-3 w-full rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-black text-white hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-50">{editing ? 'DeepSeek 수정 중…' : 'AI 수정 미리보기'}</button>
      {previewCut ? <div className="mt-4 rounded-2xl border border-fuchsia-400/30 bg-fuchsia-400/[0.07] p-4"><p className="text-[11px] font-black text-fuchsia-300">적용 전 미리보기</p><p className="mt-2 text-sm font-black text-white">{previewCut.title}</p><p className="mt-2 text-xs leading-5 text-gray-400">{previewCut.shots.map((shot) => shot.action).join(' · ')}</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => setPreviewCut(undefined)} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-gray-400">취소</button><button type="button" onClick={commitPreview} className="rounded-lg bg-fuchsia-500 px-3 py-2 text-xs font-black text-white">이 수정 적용</button></div></div> : null}
      <p aria-live="polite" className="mt-3 text-xs leading-5 text-gray-500">{message || '드래그로 순서를 바꾸거나 선택한 컷을 자연어로 수정합니다.'}</p>
    </aside>
  </div>;
}

const TakeVideo = ({projectId, assetId, label}: {projectId: string; assetId?: string; label: string}) => {
  const url = useAssetPreview(projectId, assetId);
  return <div className="flex aspect-video items-center justify-center overflow-hidden rounded-2xl bg-black">{url ? <video src={url} controls muted playsInline className="h-full w-full object-contain"/> : <span className="text-sm text-gray-600">{label} 미리보기 없음</span>}</div>;
};

export function TakeStudio() {
  const dispatch = useAppDispatch();
  const project = useAppSelector((state) => state.projectState);
  const [selectedShotId, setSelectedShotId] = useState(project.workflow.production.shotSpecs[0]?.id ?? '');
  const [viewTakeId, setViewTakeId] = useState<string>();
  const takes = useMemo(() => project.workflow.production.takes.filter((take) => take.scope === 'shot' ? take.shotSpecId === selectedShotId : true), [project.workflow.production.takes, selectedShotId]);
  const current = takes.find((take) => take.id === viewTakeId) ?? takes.find((take) => take.selected) ?? takes[0];
  const compare = takes.filter((take) => take.outputAssetId).slice(0, 2);
  const choose = (takeId: string) => { const next = selectTakeForTimeline(project, takeId); dispatch(setWorkflow(next.workflow)); dispatch(setMediaFiles(next.mediaFiles)); setViewTakeId(takeId); };

  if (!takes.length) return <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-white/[0.025] p-10 text-center"><h2 className="font-black text-white">저장된 take가 없습니다</h2><p className="mt-2 text-sm leading-6 text-gray-500">Seedance 결과가 secure ingest와 QC 승인을 통과하면 이곳에 실제 take로 저장됩니다. 유료 제출은 현재 잠겨 있습니다.</p></div>;
  return <div className="mt-8 space-y-5">
    <div className="flex flex-wrap gap-2">{project.workflow.production.shotSpecs.map((spec) => <button key={spec.id} type="button" onClick={() => setSelectedShotId(spec.id)} className={`rounded-full px-4 py-2 text-xs font-bold ${selectedShotId === spec.id ? 'bg-fuchsia-500 text-white' : 'bg-white/5 text-gray-400'}`}>{spec.cutId} · {spec.shotId}</button>)}</div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div><TakeVideo projectId={project.id} assetId={current?.outputAssetId} label={current?.id ?? 'take'}/><div className="mt-3 flex flex-wrap gap-2">{takes.map((take) => <button key={take.id} type="button" onClick={() => setViewTakeId(take.id)} className={`rounded-xl border px-3 py-2 text-xs font-bold ${current?.id === take.id ? 'border-fuchsia-400 bg-fuchsia-400/10 text-fuchsia-200' : 'border-white/10 text-gray-400'}`}>{take.id}{take.selected ? ' · 타임라인' : ''}</button>)}</div></div>
      <aside className="rounded-3xl border border-white/10 bg-[#15131a] p-5"><p className="text-xs text-gray-500">현재 버전</p><h3 className="mt-2 break-all font-black text-white">{current?.id}</h3><p className="mt-3 text-xs text-gray-400">QC {current?.qcStatus} · {current?.resolution ?? '해상도 미상'}</p>{current ? <button type="button" onClick={() => choose(current.id)} disabled={current.qcStatus !== 'approved'} className="mt-5 w-full rounded-xl bg-fuchsia-500 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40">타임라인에 이 버전 배치</button> : null}</aside>
    </div>
    {compare.length === 2 ? <div><h3 className="mb-3 font-black text-white">A/B 나란히 비교</h3><div className="grid gap-4 md:grid-cols-2">{compare.map((take, index) => <div key={take.id}><TakeVideo projectId={project.id} assetId={take.outputAssetId} label={`버전 ${index ? 'B' : 'A'}`}/><p className="mt-2 text-xs text-gray-500">{index ? 'B' : 'A'} · {take.id}</p></div>)}</div></div> : null}
  </div>;
}
