'use client';

import Image from 'next/image';
import {FormEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useAppDispatch, useAppSelector} from '@/app/store';
import {setWorkflow} from '@/app/store/slices/projectSlice';
import {StoryboardStudio, TakeStudio} from './ProductionStudio';
import {
  characterSheetSchema,
  interviewBriefSchema,
  storyboardSchema,
  styleBibleSchema,
  type CharacterSheet,
  type InterviewBrief,
  type Storyboard,
} from '@/app/lib/workflow/schema';
import {seedanceMasterSettingsSchema} from '@/app/lib/workflow/seedance-master';
import type {ProjectWorkspaceId} from '@/app/lib/editor/project-workspace';
import {deriveCreationProgress, isStoryboardBuiltFromCharacterReferences} from '@/app/lib/editor/creation-progress';
import {invalidateForCreativeChange} from '@/app/lib/workflow/approval';

type StageWorkspaceProps = {
  workspace: ProjectWorkspaceId;
  interviewBrief?: InterviewBrief;
  characterSheet?: CharacterSheet;
  characterSheets?: CharacterSheet[];
  storyboard?: Storyboard;
  sampleMode: boolean;
  onEnableSample: () => void;
  onOpenEdit: () => void;
  onNavigate: (workspace: ProjectWorkspaceId) => void;
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

export default function StageWorkspace({workspace, interviewBrief, characterSheet, characterSheets, storyboard, sampleMode, onEnableSample, onOpenEdit, onNavigate}: StageWorkspaceProps) {
  const dispatch = useAppDispatch();
  const projectId = useAppSelector((state) => state.projectState.id);
  const workflow = useAppSelector((state) => state.projectState.workflow);
  const [sentence, setSentence] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const allCharacterSheets = useMemo(
    () => characterSheets?.length ? characterSheets : characterSheet ? [characterSheet] : [],
    [characterSheet, characterSheets],
  );
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const activeCharacter = allCharacterSheets.find((sheet) => sheet.id === activeCharacterId) ?? allCharacterSheets[0];
  const styleReferenceImageIds = useMemo(() => allCharacterSheets
    .filter((sheet) => sheet.referenceImageId && workflow.styleBibleHash && sheet.referenceStyleHash === workflow.styleBibleHash && sheet.id !== activeCharacter?.id)
    .map((sheet) => sheet.referenceImageId as string), [activeCharacter?.id, allCharacterSheets, workflow.styleBibleHash]);
  const [characterPreviewUrls, setCharacterPreviewUrls] = useState<Record<string, string>>({});
  const previewRequests = useRef(new Set<string>());
  const previewFailures = useRef<Record<string, number>>({});
  const [isUploadingCharacter, setIsUploadingCharacter] = useState(false);
  const [characterUploadError, setCharacterUploadError] = useState<string | null>(null);
  const [showRecompose, setShowRecompose] = useState(false);
  const [confirmImageCredit, setConfirmImageCredit] = useState(false);
  const [imageGenerationJobId, setImageGenerationJobId] = useState<string | null>(null);
  const [generationCharacterId, setGenerationCharacterId] = useState<string | null>(null);
  const [imageGenerationStatus, setImageGenerationStatus] = useState<'idle' | 'submitting' | 'queued' | 'processing' | 'failed'>('idle');
  const [isGeneratingStoryboard, setIsGeneratingStoryboard] = useState(false);
  const [storyboardError, setStoryboardError] = useState<string | null>(null);
  const [isLockingStyle, setIsLockingStyle] = useState(false);
  const [pendingStyleAnchorId, setPendingStyleAnchorId] = useState<string | null>(null);
  const workflowRef = useRef(workflow);
  const characterSheetsRef = useRef(allCharacterSheets);
  useEffect(() => { workflowRef.current = workflow; }, [workflow]);
  useEffect(() => { characterSheetsRef.current = allCharacterSheets; }, [allCharacterSheets]);
  const styleBible = workflow.styleBible;
  const styleBibleHash = workflow.styleBibleHash;
  const storyboardIsCurrent = isStoryboardBuiltFromCharacterReferences(storyboard, allCharacterSheets, styleBibleHash);
  const readyCharacterCount = allCharacterSheets.filter((sheet) => sheet.referenceImageId).length;
  const styleConfirmedCharacterCount = allCharacterSheets.filter((sheet) => styleBibleHash && sheet.referenceStyleHash === styleBibleHash).length;
  const characterCount = allCharacterSheets.length;
  const progress = deriveCreationProgress({brief: interviewBrief, styleBible, styleBibleHash, characterSheets: allCharacterSheets, hasStoryboard: storyboardIsCurrent, workspace});

  useEffect(() => {
    if (storyboard && allCharacterSheets.every((sheet) => sheet.referenceImageId) && !storyboardIsCurrent) {
      dispatch(setWorkflow(invalidateForCreativeChange({...workflowRef.current, storyboard: undefined})));
    }
  }, [allCharacterSheets, dispatch, storyboard, storyboardIsCurrent]);

  const connectCharacterReference = useCallback((characterId: string, assetId: string, previewUrl: string, lineage?: {styleBibleHash: string; styleReferenceImageIds: string[]}) => {
    const nextSheets = characterSheetsRef.current.map((sheet) =>
      (sheet.id ?? sheet.name) === characterId ? {...sheet, referenceImageId: assetId, referenceStyleHash: lineage?.styleBibleHash, styleReferenceImageIds: lineage?.styleReferenceImageIds} : sheet,
    );
    dispatch(setWorkflow(invalidateForCreativeChange({
      ...workflowRef.current,
      characterSheet: nextSheets[0],
      characterSheets: nextSheets,
      storyboard: undefined,
    })));
    setCharacterPreviewUrls((current) => ({...current, [characterId]: previewUrl}));
  }, [dispatch]);

  useEffect(() => {
    const pending = allCharacterSheets.filter((sheet) => {
      const characterId = sheet.id ?? sheet.name;
      return sheet.referenceImageId
        && !characterPreviewUrls[characterId]
        && !previewRequests.current.has(characterId)
        && (previewFailures.current[characterId] ?? 0) < 2;
    });
    if (pending.length === 0) return;
    let cancelled = false;
    void Promise.all(pending.map(async (sheet) => {
      const characterId = sheet.id ?? sheet.name;
      previewRequests.current.add(characterId);
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(sheet.referenceImageId!)}/ui-capability`, {method: 'POST'});
        const payload = response.ok ? await response.json() as {url?: string} : undefined;
        if (!payload?.url) previewFailures.current[characterId] = (previewFailures.current[characterId] ?? 0) + 1;
        return [characterId, payload?.url] as const;
      } finally {
        previewRequests.current.delete(characterId);
      }
    })).then((entries) => {
      if (!cancelled) setCharacterPreviewUrls((current) => ({...current, ...Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])))}));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [allCharacterSheets, characterPreviewUrls, projectId]);

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
      const parsedSheets = Array.isArray(payload.characterSheets)
        ? payload.characterSheets.map((sheet) => characterSheetSchema.parse(sheet))
        : [characterSheetSchema.parse(payload.characterSheet)];
      dispatch(setWorkflow({
        ...invalidateForCreativeChange(workflow),
        planningStatus: 'draft',
        interviewBrief: interviewBriefSchema.parse(payload.interviewBrief),
        styleBible: styleBibleSchema.parse(payload.styleBible),
        styleBibleHash: typeof payload.styleBibleHash === 'string' ? payload.styleBibleHash : undefined,
        characterSheet: parsedSheets[0],
        characterSheets: parsedSheets,
        storyboard: undefined,
        seedanceMaster: seedanceMasterSettingsSchema.parse(payload.seedanceMaster),
      }));
      setShowRecompose(false);
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : 'AI 기획을 완료하지 못했습니다.');
    } finally {
      setIsComposing(false);
    }
  };

  const generateStoryboard = async () => {
    if (!interviewBrief || !styleBible || !styleBibleHash || allCharacterSheets.length === 0 || allCharacterSheets.some((sheet) => !sheet.referenceImageId || sheet.referenceStyleHash !== styleBibleHash) || isGeneratingStoryboard) return;
    setIsGeneratingStoryboard(true);
    setStoryboardError(null);
    try {
      const response = await fetch('/api/vlog/storyboard', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({projectId, sentence: `${interviewBrief.subject}. ${interviewBrief.action}. ${interviewBrief.extraNotes ?? ''}`.trim(), interviewBrief, styleBible, styleBibleHash, characterSheets: allCharacterSheets}),
      });
      const payload = await response.json() as {storyboard?: unknown; error?: string};
      if (!response.ok || !payload.storyboard) throw new Error(payload.error ?? '스토리보드를 생성하지 못했습니다.');
      dispatch(setWorkflow(invalidateForCreativeChange({...workflow, storyboard: storyboardSchema.parse(payload.storyboard)})));
      onNavigate('storyboard');
    } catch (error) {
      setStoryboardError(error instanceof Error ? error.message : '스토리보드를 생성하지 못했습니다.');
    } finally {
      setIsGeneratingStoryboard(false);
    }
  };

  const startCharacterImageGeneration = async () => {
    if (!activeCharacter?.id || !styleBible || !styleBibleHash || !confirmImageCredit || ['submitting', 'queued', 'processing'].includes(imageGenerationStatus)) return;
    setCharacterUploadError(null);
    setImageGenerationStatus('submitting');
    const prompt = [
      'Create one polished cinematic CHARACTER MASTER SHEET for a video production.',
      '[PROJECT STYLE — LOCKED, inherit identically across every character]',
      `Visual medium: ${styleBible.visualMedium}. Realism: ${styleBible.realism}. Render language: ${styleBible.renderLanguage}.`,
      `Proportion rules: ${styleBible.proportionRules}. Lighting: ${styleBible.lighting}. Lens and depth: ${styleBible.lensAndDepth}.`,
      `Background: ${styleBible.background}. Texture and color science: ${styleBible.textureAndColor}.`,
      `Never: ${styleBible.negativeConstraints.join(', ')}.`,
      '[CHARACTER IDENTITY — ONLY VARIABLE]',
      `Character name: ${activeCharacter.name}.`,
      activeCharacter.breed ? `Character type or breed: ${activeCharacter.breed}.` : '',
      `Visual traits: ${activeCharacter.visualTags.join(', ')}.`,
      `Color palette: ${Object.entries(activeCharacter.palette).map(([label, color]) => `${label} ${color}`).join(', ')}.`,
      interviewBrief ? `Project mood: ${interviewBrief.tone}.` : '',
      'Show the same identity in a full-body hero view plus front, side, and three-quarter views. Keep anatomy, materials, lighting, lens, background, and rendering medium identical to the attached project master reference. Use attached images for STYLE only; do not copy another character identity.',
      'No text, letters, numbers, captions, logos, watermarks, UI, signage, or brand marks anywhere in the image.',
    ].filter(Boolean).join(' ');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/character-image`, {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({characterId: activeCharacter.id, prompt, styleBibleHash, styleReferenceImageIds, confirmCreditCost: 1}),
      });
      const payload = await response.json() as {jobId?: string; error?: string};
      if (!response.ok || !payload.jobId) throw new Error(payload.error ?? '이미지 생성 요청 실패');
      setGenerationCharacterId(activeCharacter.id ?? activeCharacter.name);
      setImageGenerationJobId(payload.jobId);
      setImageGenerationStatus('queued');
    } catch (error) {
      setImageGenerationStatus('failed');
      setCharacterUploadError(error instanceof Error ? error.message : '캐릭터 이미지 생성을 시작하지 못했습니다.');
    }
  };

  useEffect(() => {
    if (!imageGenerationJobId || !['queued', 'processing'].includes(imageGenerationStatus)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/character-image?jobId=${encodeURIComponent(imageGenerationJobId)}&characterId=${encodeURIComponent(generationCharacterId ?? '')}`);
        const payload = await response.json() as {status?: string; assetId?: string; previewUrl?: string; lineage?: {styleBibleHash: string; styleReferenceImageIds: string[]}; error?: string};
        if (!response.ok) throw new Error(payload.error ?? '이미지 상태 조회 실패');
        if (payload.status === 'completed' && payload.assetId && payload.previewUrl) {
          if (cancelled) return;
          if (!generationCharacterId) throw new Error('생성 대상 캐릭터를 확인하지 못했습니다.');
          connectCharacterReference(generationCharacterId, payload.assetId, payload.previewUrl, payload.lineage);
          setImageGenerationJobId(null);
          setGenerationCharacterId(null);
          setImageGenerationStatus('idle');
          setConfirmImageCredit(false);
          return;
        }
        if (payload.status === 'failed' || payload.status === 'error') throw new Error('Higgsfield 이미지 생성이 실패했습니다.');
        if (!cancelled) setImageGenerationStatus('processing');
      } catch (error) {
        if (!cancelled) {
          setImageGenerationStatus('failed');
          setCharacterUploadError(error instanceof Error ? error.message : '캐릭터 이미지 결과를 확인하지 못했습니다.');
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [connectCharacterReference, generationCharacterId, imageGenerationJobId, imageGenerationStatus, projectId]);

  const uploadCharacterReference = async (file: File) => {
    if (!activeCharacter || isUploadingCharacter) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setCharacterUploadError('PNG, JPEG, WebP 이미지만 등록할 수 있습니다.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setCharacterUploadError('이미지는 20MB 이하여야 합니다.');
      return;
    }
    setIsUploadingCharacter(true);
    setCharacterUploadError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets/ui-upload`, {
        method: 'POST',
        headers: {'content-type': file.type},
        body: file,
      });
      const payload = await response.json() as {assetId?: string; previewUrl?: string; error?: string};
      if (!response.ok || !payload.assetId || !payload.previewUrl) throw new Error(payload.error || '기준 이미지를 등록하지 못했습니다.');
      connectCharacterReference(activeCharacter.id ?? activeCharacter.name, payload.assetId, payload.previewUrl);
    } catch (error) {
      setCharacterUploadError(error instanceof Error ? error.message : '기준 이미지를 등록하지 못했습니다.');
    } finally {
      setIsUploadingCharacter(false);
    }
  };

  const lockActiveReferenceAsProjectStyle = async () => {
    if (!activeCharacter?.referenceImageId || pendingStyleAnchorId !== activeCharacter.referenceImageId || !interviewBrief || isLockingStyle) return;
    setIsLockingStyle(true);
    setCharacterUploadError(null);
    try {
      const response = await fetch('/api/vlog/style-bible', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({projectId, anchorReferenceImageId: activeCharacter.referenceImageId, tone: interviewBrief.tone})});
      const payload = await response.json() as {styleBible?: unknown; styleBibleHash?: string; error?: string};
      if (!response.ok || !payload.styleBibleHash) throw new Error(payload.error ?? '스타일 기준을 확정하지 못했습니다.');
      const lockedBible = styleBibleSchema.parse(payload.styleBible);
      const nextSheets = characterSheetsRef.current.map((sheet) => sheet.id === activeCharacter.id
        ? {...sheet, referenceStyleHash: payload.styleBibleHash, styleReferenceImageIds: []}
        : {...sheet, referenceStyleHash: undefined, styleReferenceImageIds: undefined});
      dispatch(setWorkflow(invalidateForCreativeChange({...workflowRef.current, styleBible: lockedBible, styleBibleHash: payload.styleBibleHash, characterSheet: nextSheets[0], characterSheets: nextSheets, storyboard: undefined})));
      setPendingStyleAnchorId(null);
      setConfirmImageCredit(false);
    } catch (error) {
      setCharacterUploadError(error instanceof Error ? error.message : '스타일 기준을 확정하지 못했습니다.');
    } finally { setIsLockingStyle(false); }
  };

  if (workspace === 'interview') {
    const planningApproved = workflow.planningStatus === 'approved';
    return (
      <section className="h-full overflow-y-auto bg-[#0c0b10] p-6 lg:p-10">
        <div className="mx-auto flex min-h-full max-w-5xl flex-col">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-fuchsia-300">1 · AI 인터뷰</p>
              <h1 className="mt-2 text-3xl font-black text-white text-balance">어떤 영상을 만들고 싶으세요?</h1>
              <p className="mt-2 text-sm leading-6 text-gray-400">한 문장으로 시작하면 AI가 브리프와 출연 캐릭터 시트를 구성합니다.</p>
            </div>
            {!sampleMode && !interviewBrief ? <button type="button" onClick={onEnableSample} className="shrink-0 rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-gray-200 hover:border-fuchsia-400/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400">샘플 프로젝트 보기</button> : null}
          </div>

          <div className="mt-10 flex-1 space-y-5">
            {isComposing ? (
              <div className="max-w-3xl overflow-hidden rounded-3xl border border-fuchsia-400/30 bg-fuchsia-500/[0.08] p-7 shadow-[0_0_60px_rgba(217,70,239,0.10)]" aria-live="polite">
                <div className="flex items-center gap-3"><span className="h-3 w-3 animate-pulse rounded-full bg-fuchsia-400"/><span className="text-sm font-black text-fuchsia-200">요청을 받았습니다 · AI 기획 작업 중</span></div>
                <h2 className="mt-5 text-2xl font-black text-white">브리프와 출연 캐릭터 시트를 구성하고 있어요</h2>
                <div className="mt-6 grid gap-3 sm:grid-cols-3">{['영상 브리프 분석', '출연 캐릭터 분리', '캐릭터 시트 작성'].map((label, index) => <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="text-xs font-black text-fuchsia-300">0{index + 1}</div><div className="mt-2 text-sm font-bold text-gray-200">{label}</div></div>)}</div>
                <p className="mt-5 text-xs text-gray-400">제출한 문장: “{sentence.trim()}”</p>
              </div>
            ) : interviewBrief ? (
              <div className="max-w-4xl rounded-3xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/[0.10] via-[#17151d] to-fuchsia-500/[0.08] p-7 shadow-[0_0_70px_rgba(52,211,153,0.10)]">
                <div className="flex flex-wrap items-center justify-between gap-3"><div className={`flex items-center gap-2 text-sm font-black ${planningApproved ? 'text-emerald-200' : 'text-amber-200'}`}><span className={`grid h-7 w-7 place-items-center rounded-full text-sm text-black ${planningApproved ? 'bg-emerald-400' : 'bg-amber-300'}`}>{planningApproved ? '✓' : '!'}</span>{planningApproved ? '내가 확정한 기획입니다' : 'AI가 만든 기획 초안입니다'}</div><div className="flex gap-2 text-[11px] font-bold text-gray-300"><span className="rounded-full bg-white/10 px-3 py-1.5">브리프 생성</span><span className="rounded-full bg-white/10 px-3 py-1.5">캐릭터 설정 생성</span><span className={`rounded-full px-3 py-1.5 ${planningApproved ? 'bg-emerald-400/10 text-emerald-200' : 'bg-amber-400/10 text-amber-200'}`}>{planningApproved ? '기획 확정' : '내 검수 필요'}</span></div></div>
                <p className="mt-7 text-xs font-black uppercase tracking-[0.18em] text-fuchsia-300">기획 요약</p>
                <h2 className="mt-2 text-3xl font-black text-white">{interviewBrief.subject}</h2>
                <p className="mt-3 text-base leading-7 text-gray-300">{interviewBrief.action}</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-black/20 p-4"><div className="text-xs text-gray-500">길이</div><div className="mt-1 text-lg font-black text-white">{interviewBrief.durationSeconds}초</div></div><div className="rounded-2xl bg-black/20 p-4"><div className="text-xs text-gray-500">분위기</div><div className="mt-1 text-sm font-bold text-white">{interviewBrief.tone}</div></div><div className="rounded-2xl bg-black/20 p-4"><div className="text-xs text-gray-500">핵심 대사</div><div className="mt-1 text-sm font-bold text-white">{interviewBrief.greetingLine}</div></div></div>
                <div className={`mt-7 rounded-2xl border p-5 ${planningApproved ? 'border-fuchsia-400/25 bg-fuchsia-500/[0.08]' : 'border-amber-400/25 bg-amber-400/[0.07]'}`}><p className="text-sm font-black text-white">{planningApproved ? '다음으로 캐릭터 기준을 만드세요' : '이 내용으로 영상을 만들지 직접 결정하세요'}</p><p className="mt-1 text-sm text-gray-400">{planningApproved ? '확정한 캐릭터 설정을 기준으로 실제 이미지를 선택하고 만듭니다.' : '주제·행동·길이·분위기·대사를 확인하세요. 마음에 들지 않으면 새 문장으로 다시 만들 수 있습니다.'}</p>{planningApproved ? <button type="button" onClick={() => onNavigate('reference')} className="mt-4 rounded-xl bg-fuchsia-500 px-5 py-3 text-sm font-black text-white hover:bg-fuchsia-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300">다음: 캐릭터 기준 만들기 →</button> : <div className="mt-4 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => { setSentence(''); setShowRecompose(true); }} className="rounded-xl border border-white/15 px-5 py-3 text-sm font-black text-white">내용 바꿔서 다시 만들기</button><button type="button" onClick={() => dispatch(setWorkflow({...workflow, planningStatus: 'approved'}))} className="rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-black">검수 완료 · 이 기획 확정</button></div>}</div>
              </div>
            ) : (
              <div className="max-w-3xl rounded-3xl border border-white/10 bg-white/[0.035] p-6">
                <p className="text-sm leading-6 text-gray-300">예: “따뜻한 오후의 거실에서 크림색 시바견 루이가 카메라를 바라보는 20초 브랜드 필름을 만들어줘.”</p>
              </div>
            )}
          </div>

          {!interviewBrief || isComposing || showRecompose ? (
            <form onSubmit={compose} className="sticky bottom-0 mt-8 rounded-3xl border border-white/15 bg-[#17151d]/95 p-3 shadow-2xl backdrop-blur">
              <label htmlFor="video-concept" className="sr-only">영상 콘셉트</label>
              <textarea id="video-concept" name="videoConcept" value={sentence} onChange={(event) => setSentence(event.target.value)} rows={3} placeholder="만들고 싶은 영상을 설명해 주세요…" className="w-full resize-none rounded-2xl bg-transparent px-4 py-3 text-base leading-6 text-white placeholder:text-gray-500 focus-visible:outline-none" disabled={isComposing}/>
              <div className="flex items-center justify-between gap-4 px-2 pb-1">
                <p aria-live="polite" className={`text-xs ${composeError ? 'text-red-300' : 'text-gray-500'}`}>{composeError ?? (isComposing ? '요청 제출 완료 · AI가 기획 산출물을 만들고 있습니다…' : '입력한 문장은 프로젝트 기획 데이터로 저장됩니다.')}</p>
                <button type="submit" disabled={!sentence.trim() || isComposing} className="rounded-xl bg-fuchsia-500 px-5 py-2.5 text-sm font-black text-white hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300">{isComposing ? '기획 작업 중…' : '이 내용으로 기획 만들기 →'}</button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => { setSentence(''); setShowRecompose(true); }} className="mt-5 self-start text-xs font-bold text-gray-500 underline decoration-gray-700 underline-offset-4 hover:text-gray-300">새 문장으로 기획 다시 만들기</button>
          )}
        </div>
      </section>
    );
  }

  if (workspace === 'reference') {
    const displayed = activeCharacter ?? (sampleMode ? SAMPLE_CHARACTER : undefined);
    const activeKey = displayed ? displayed.id ?? displayed.name : '';
    const activePreviewUrl = characterPreviewUrls[activeKey];
    const readyCount = allCharacterSheets.filter((sheet) => sheet.referenceImageId).length;
    const anchorCandidates = allCharacterSheets.filter((sheet) => sheet.referenceImageId && sheet.referenceStyleHash === workflow.styleBibleHash && (sheet.styleReferenceImageIds ?? []).length === 0);
    const anchorReferenceId = anchorCandidates.length === 1 ? anchorCandidates[0].referenceImageId : undefined;
    const isSheetStyleLocked = (sheet: CharacterSheet) => Boolean(anchorReferenceId && sheet.referenceStyleHash === workflow.styleBibleHash && (sheet.referenceImageId === anchorReferenceId || (sheet.styleReferenceImageIds ?? []).includes(anchorReferenceId)));
    const styleLockedCount = allCharacterSheets.filter(isSheetStyleLocked).length;
    const activeStyleLocked = activeCharacter ? isSheetStyleLocked(activeCharacter) : false;
    const totalCount = allCharacterSheets.length;
    return (
      <section className="h-full overflow-y-auto bg-[#0c0b10] p-6 lg:p-10">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-fuchsia-300">2 · 기준 시트</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div><h1 className="text-3xl font-black text-white">출연 캐릭터별 기준을 고정합니다</h1><p className="mt-2 text-sm text-gray-400">메인 캐릭터마다 별도 기준 이미지가 필요합니다. 강아지와 다람쥐라면 각각 한 장씩 준비합니다.</p></div>
            {totalCount ? <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"><div className="text-right"><p className="text-xs text-gray-500">이미지 · 스타일 잠금</p><p className="mt-1 text-xl font-black text-white">{readyCount}/{totalCount} · {styleLockedCount}/{totalCount}</p></div>{progress.state === 'character-ready' ? <button type="button" disabled={isGeneratingStoryboard} onClick={() => storyboardIsCurrent ? onNavigate('storyboard') : void generateStoryboard()} className="rounded-xl bg-fuchsia-500 px-4 py-2.5 text-sm font-black text-white hover:bg-fuchsia-400 disabled:cursor-wait disabled:opacity-60">{storyboardIsCurrent ? '스토리보드 검수 →' : isGeneratingStoryboard ? '생성 중…' : '스토리보드 생성 →'}</button> : null}</div> : null}
          </div>
          {!displayed ? <div className="mt-8"><EmptyState title="기준 시트가 없습니다" description="인터뷰에서 AI 기획을 완료하세요. AI가 주요 출연 캐릭터를 분리해 각각의 기준 시트를 만듭니다."/></div> : (
            <>
              {!sampleMode && allCharacterSheets.length > 0 ? <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{allCharacterSheets.map((sheet, index) => {
                const key = sheet.id ?? sheet.name;
                const selected = key === activeKey;
                const preview = characterPreviewUrls[key];
                return <button key={key} type="button" onClick={() => { setActiveCharacterId(key); setCharacterUploadError(null); setConfirmImageCredit(false); }} className={`overflow-hidden rounded-2xl border text-left transition ${selected ? 'border-fuchsia-400 bg-fuchsia-500/[0.10] shadow-[0_0_35px_rgba(217,70,239,0.12)]' : 'border-white/10 bg-[#15131a] hover:border-white/25'}`}>
                  <div className="flex items-center gap-4 p-4">{preview ? <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-black"><Image src={preview} alt={`${sheet.name} 미리보기`} fill unoptimized className="object-cover" sizes="96px" onLoad={() => { previewFailures.current[key] = 0; }} onError={() => { previewFailures.current[key] = (previewFailures.current[key] ?? 0) + 1; setCharacterPreviewUrls((current) => { const next = {...current}; delete next[key]; return next; }); }}/></div> : <div className="grid h-16 w-24 shrink-0 place-items-center rounded-xl border border-dashed border-white/15 bg-black/30 text-xl text-fuchsia-300">✦</div>}<div className="min-w-0"><p className="text-[11px] font-black text-fuchsia-300">캐릭터 {index + 1}</p><p className="mt-1 truncate text-lg font-black text-white">{sheet.name}</p><p className={`mt-1 text-xs font-bold ${isSheetStyleLocked(sheet) ? 'text-emerald-300' : sheet.referenceImageId ? 'text-amber-300' : 'text-red-300'}`}>{isSheetStyleLocked(sheet) ? sheet.referenceImageId === anchorReferenceId ? '✓ 프로젝트 스타일 기준' : '✓ 스타일 잠금 완료' : sheet.referenceImageId ? '스타일 검수 필요' : '기준 이미지 필요'}</p></div></div>
                </button>;
              })}</div> : null}

              <div className="mt-5 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
                <article className="overflow-hidden rounded-3xl border border-white/10 bg-[#15131a]">
                  {sampleMode ? <><div className="border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-bold text-amber-200">샘플 전용 · 현재 프로젝트의 승인 대상이 아닙니다</div><div className="relative aspect-[16/10] bg-black"><Image src="/mock-assets/reference-shiba.webp" alt="샘플 시바견 마스터 시트" fill className="object-contain" sizes="70vw" priority/></div></> : activePreviewUrl ? <><div className={`border-b px-4 py-3 text-xs font-bold ${activeStyleLocked ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-amber-400/20 bg-amber-400/10 text-amber-100'}`}>{activeStyleLocked ? `✓ ${displayed.name} · 프로젝트 스타일 잠금 완료` : workflow.styleBibleHash ? `${displayed.name} · 현재 프로젝트 스타일과 일치 확인이 필요합니다` : <span className="flex flex-wrap items-center justify-between gap-3"><span>{displayed.name} · 기존 이미지는 아직 공통 스타일 기준이 아닙니다</span><button type="button" disabled={isLockingStyle} onClick={() => setPendingStyleAnchorId(displayed.referenceImageId ?? null)} className="rounded-lg bg-amber-300 px-3 py-1.5 font-black text-black disabled:opacity-50">이 이미지를 스타일 기준으로 선택</button></span>}</div><div className="relative aspect-[16/10] bg-black"><Image src={activePreviewUrl} alt={`${displayed.name} 기준 이미지`} fill unoptimized className="object-contain" sizes="70vw" onLoad={() => { previewFailures.current[activeKey] = 0; }} onError={() => { previewFailures.current[activeKey] = (previewFailures.current[activeKey] ?? 0) + 1; setCharacterPreviewUrls((current) => { const next = {...current}; delete next[activeKey]; return next; }); }}/></div>{workflow.styleBibleHash && !activeStyleLocked ? <div className="border-t border-fuchsia-400/20 bg-fuchsia-500/[0.06] p-4"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-black text-white">프로젝트 스타일로 다시 생성</p><p className="mt-1 text-xs text-gray-400">잠긴 Master Sheet {styleReferenceImageIds.length}장을 실제 이미지 reference로 사용합니다.</p></div><span className="rounded-full bg-amber-400/15 px-3 py-1 text-xs font-black text-amber-200">1 credit</span></div><label className="mt-3 flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3"><input type="checkbox" className="mt-0.5 accent-fuchsia-500" checked={confirmImageCredit} onChange={(event) => setConfirmImageCredit(event.target.checked)}/><span className="text-xs leading-5 text-gray-300">{displayed.name} 기존 이미지는 보존하고, 스타일 일치 이미지 1장을 새로 생성하는 데 1 credit 사용을 확인합니다.</span></label><button type="button" disabled={!confirmImageCredit || styleReferenceImageIds.length === 0 || ['submitting', 'queued', 'processing'].includes(imageGenerationStatus)} onClick={() => void startCharacterImageGeneration()} className="mt-3 w-full rounded-xl bg-fuchsia-500 px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{imageGenerationStatus === 'submitting' ? '제출 중…' : imageGenerationStatus === 'queued' || imageGenerationStatus === 'processing' ? '스타일 일치 이미지 생성 중…' : `${displayed.name} 다시 생성`}</button></div> : null}</> : <div className="flex aspect-[16/10] flex-col items-center justify-center border-b border-dashed border-white/10 bg-black/40 px-8 text-center"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-fuchsia-500/15 text-2xl">✦</div><p className="mt-4 text-lg font-black text-white">{displayed.name} 기준 이미지를 만드세요</p><p className="mt-2 max-w-md text-sm leading-6 text-gray-500">현재 선택한 캐릭터만 생성합니다. 다른 캐릭터는 위 카드에서 따로 선택해 준비합니다.</p><div className="mt-5 w-full max-w-xl rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/[0.07] p-4 text-left"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-black text-white">Higgsfield AI 캐릭터 이미지</p><p className="mt-1 text-xs leading-5 text-gray-400">Nano Banana 2 Lite · 1K · 16:9 · 1장</p></div><span className="shrink-0 rounded-full bg-amber-400/15 px-3 py-1 text-xs font-black text-amber-200">1 credit</span></div><label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3"><input type="checkbox" className="mt-0.5 accent-fuchsia-500" checked={confirmImageCredit} disabled={['submitting', 'queued', 'processing'].includes(imageGenerationStatus)} onChange={(event) => { setConfirmImageCredit(event.target.checked); if (imageGenerationStatus === 'failed') setImageGenerationStatus('idle'); }}/><span className="text-xs leading-5 text-gray-300">{displayed.name} 이미지 1장 생성에 1 credit 사용을 확인합니다.</span></label><button type="button" disabled={!confirmImageCredit || ['submitting', 'queued', 'processing'].includes(imageGenerationStatus)} onClick={() => void startCharacterImageGeneration()} className="mt-3 w-full rounded-xl bg-fuchsia-500 px-4 py-2.5 text-sm font-black text-white hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40">{imageGenerationStatus === 'submitting' ? '제출 중…' : imageGenerationStatus === 'queued' || imageGenerationStatus === 'processing' ? '이미지 생성 처리 중…' : imageGenerationStatus === 'failed' ? '1 credit으로 다시 생성' : `${displayed.name} 이미지 생성`}</button></div></div>}
                  {pendingStyleAnchorId === displayed.referenceImageId && !workflow.styleBibleHash ? <div className="border-t border-amber-300/25 bg-amber-300/[0.08] p-4"><p className="text-sm font-black text-amber-100">이 화풍을 프로젝트 전체 기준으로 사용할까요?</p><p className="mt-2 text-xs leading-5 text-amber-50/70">확정하면 {displayed.name} 이미지는 기준으로 보존되고, 나머지 {Math.max(0, totalCount - 1)}명은 같은 화풍으로 다시 만들어야 합니다. 예상 추가 비용은 최대 {Math.max(0, totalCount - 1)} credit입니다.</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => setPendingStyleAnchorId(null)} className="flex-1 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-black text-white">다른 이미지 비교</button><button type="button" disabled={isLockingStyle} onClick={() => void lockActiveReferenceAsProjectStyle()} className="flex-1 rounded-xl bg-amber-300 px-4 py-2.5 text-sm font-black text-black disabled:opacity-50">{isLockingStyle ? '확정 중…' : `${displayed.name} 화풍으로 확정`}</button></div></div> : null}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 p-4"><div><p className="text-sm font-black text-white">보유 이미지로 등록</p><p className="mt-1 text-xs text-gray-500">PNG · JPEG · WebP · 최대 20MB</p></div><label className={`cursor-pointer rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-gray-200 hover:border-fuchsia-400/60 hover:text-white ${isUploadingCharacter ? 'pointer-events-none opacity-50' : ''}`}>{isUploadingCharacter ? '등록 중…' : `${displayed.name} 이미지 등록`}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void uploadCharacterReference(file); event.currentTarget.value = ''; }}/></label></div>
                  {characterUploadError ? <p className="border-t border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-xs text-red-200">{characterUploadError}</p> : null}
                </article>
                <aside className="rounded-3xl border border-white/10 bg-[#15131a] p-6"><p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-300">선택한 캐릭터</p><h2 className="mt-2 text-xl font-black text-white">{displayed.name}</h2><p className="mt-1 text-sm text-gray-400">{displayed.breed ?? '캐릭터 기준'}</p><div className="mt-5 flex flex-wrap gap-2">{displayed.visualTags.map((tag) => <span key={tag} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-300">{tag}</span>)}</div><div className="mt-8 space-y-3">{Object.entries(displayed.palette).map(([label, color]) => <div key={label} className="flex items-center gap-3"><span className="h-9 w-9 rounded-xl border border-white/10" style={{backgroundColor: color}}/><span className="text-sm text-gray-300">{label}</span><code className="ml-auto text-xs text-gray-500">{color}</code></div>)}</div></aside>
              </div>

              {!sampleMode ? <>
                {progress.state !== 'character-ready' ? <div className="mt-6 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4 text-sm text-amber-100"><strong>아직 {totalCount - readyCount}명의 기준 이미지가 필요합니다.</strong> 모든 주요 캐릭터의 기준 이미지가 준비된 뒤 그 시트를 입력으로 스토리보드를 생성합니다.</div> : storyboard ? <div className="mt-6 rounded-3xl border border-fuchsia-400/25 bg-gradient-to-r from-fuchsia-500/[0.10] to-violet-500/[0.08] p-6"><div className="flex flex-wrap items-center justify-between gap-5"><div><p className="text-sm font-black text-fuchsia-200">✓ 스토리보드 생성 완료</p><h2 className="mt-2 text-2xl font-black text-white">{storyboard.cuts.length}컷을 검수하세요</h2><p className="mt-1 text-sm text-gray-400">준비된 캐릭터 시트와 기준 이미지를 바탕으로 생성됐습니다.</p></div><button type="button" onClick={() => onNavigate('storyboard')} className="rounded-xl bg-fuchsia-500 px-6 py-3.5 text-sm font-black text-white hover:bg-fuchsia-400">스토리보드 검수 →</button></div></div> : <div className="mt-6 rounded-3xl border border-emerald-400/25 bg-gradient-to-r from-emerald-500/[0.10] to-fuchsia-500/[0.08] p-6"><div className="flex flex-wrap items-center justify-between gap-5"><div><p className="text-sm font-black text-emerald-200">✓ 주요 캐릭터 {totalCount}명의 기준 이미지 준비 완료</p><h2 className="mt-2 text-2xl font-black text-white">다음: 스토리보드 생성</h2><p className="mt-1 text-sm text-gray-400">확정된 캐릭터 시트와 기준 이미지를 입력으로 장면을 구성합니다.</p></div><button type="button" disabled={isGeneratingStoryboard} onClick={() => void generateStoryboard()} className="rounded-xl bg-fuchsia-500 px-6 py-3.5 text-sm font-black text-white hover:bg-fuchsia-400 disabled:cursor-wait disabled:opacity-60">{isGeneratingStoryboard ? '스토리보드 생성 중…' : '스토리보드 생성 →'}</button></div>{storyboardError ? <p className="mt-4 text-sm text-red-200">{storyboardError}</p> : null}</div>}
              </> : null}
            </>
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
          {!cuts.length ? <div className="mt-8">{progress.state === 'character-ready' ? <div className="rounded-3xl border border-fuchsia-400/25 bg-fuchsia-500/[0.08] p-8 text-center"><h2 className="text-2xl font-black text-white">기준 이미지 검수가 끝났습니다</h2><p className="mt-3 text-sm leading-6 text-gray-400">확정한 캐릭터 이미지와 프로젝트 화풍을 입력으로 스토리보드를 만듭니다. 생성 후 컷별로 직접 수정하고 승인할 수 있습니다.</p><button type="button" disabled={isGeneratingStoryboard} onClick={() => void generateStoryboard()} className="mt-5 rounded-xl bg-fuchsia-500 px-6 py-3 text-sm font-black text-white disabled:opacity-50">{isGeneratingStoryboard ? '스토리보드 생성 중…' : '스토리보드 생성'}</button>{storyboardError ? <p className="mt-3 text-sm text-red-200">{storyboardError}</p> : null}</div> : <div className="rounded-3xl border border-amber-400/25 bg-amber-400/[0.07] p-8 text-center"><h2 className="text-2xl font-black text-white">캐릭터 검수가 아직 끝나지 않았습니다</h2><p className="mt-3 text-sm leading-6 text-gray-300">{progress.state === 'style-review-needed' ? `프로젝트 화풍과 일치하지 않는 캐릭터 ${Math.max(0, characterCount - styleConfirmedCharacterCount)}명이 남았습니다.` : `기준 이미지가 없는 캐릭터 ${Math.max(0, characterCount - readyCharacterCount)}명이 남았습니다.`}</p><p className="mt-1 text-xs text-gray-500">기준 시트에서 이미지를 직접 확인하고 확정해야 스토리보드를 만들 수 있습니다.</p><button type="button" onClick={() => onNavigate('reference')} className="mt-5 rounded-xl bg-amber-300 px-6 py-3 text-sm font-black text-black">기준 시트로 돌아가기</button></div>}</div> : storyboard ? <StoryboardStudio storyboard={storyboard} characterSheets={allCharacterSheets}/> : (
            <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {cuts.map((cut, index) => {
                const action = 'action' in cut ? cut.action : cut.shots.map((shot) => shot.action).join(' · ');
                const start = 'start' in cut ? cut.start : cut.absoluteStartSeconds;
                const end = 'end' in cut ? cut.end : cut.absoluteEndSeconds;
                return <article key={cut.id} className="overflow-hidden rounded-3xl border border-white/10 bg-[#15131a]">
                  <div className="relative aspect-video bg-black"><Image src={`/mock-assets/story-0${(index % 3) + 1}.webp`} alt={`샘플 장면 ${index + 1}`} fill className="object-cover" sizes="25vw"/><span className="absolute left-3 top-3 rounded-full bg-amber-400 px-2 py-1 text-[11px] font-black text-black">샘플 · 승인 제외</span></div>
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
          </div> : <TakeStudio/>}
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
