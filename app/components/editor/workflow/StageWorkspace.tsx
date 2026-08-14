'use client';

import Image from 'next/image';
import {FormEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useAppDispatch, useAppSelector} from '@/app/store';
import {
  acknowledgeProjectRevision,
  installPlanningIfCurrent,
  installStoryboardIfCurrent,
  setPlanningStatus,
  setWorkflow,
} from '@/app/store/slices/projectSlice';
import {StoryboardStudio, TakeStudio} from './ProductionStudio';
import {
  characterSheetSchema,
  interviewBriefSchema,
  styleBibleSchema,
  type CharacterSheet,
  type InterviewBrief,
  type Storyboard,
} from '@/app/lib/workflow/schema';
import type {ProjectWorkspaceId} from '@/app/lib/editor/project-workspace';
import {deriveCreationProgress, isStoryboardBuiltFromCharacterReferences} from '@/app/lib/editor/creation-progress';
import {shouldUseSampleFallback} from '@/app/lib/editor/sample-fallback';
import {invalidateForCreativeChange} from '@/app/lib/workflow/approval';
import {isPlanningRequestCurrent, preparePlanningInstallCommand} from '@/app/lib/workflow/planning-apply';
import {
  applyCompletedStoryboardJob,
  prepareCompletedStoryboardJobCommand,
  storyboardJobResponseSchema,
  type StoryboardJobResponse,
} from '@/app/lib/storyboard-jobs/storyboard-job-client';
import {storyboardJobInputSchema, type StoryboardJobInput} from '@/app/lib/storyboard-jobs/storyboard-job-schema';

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

const SAMPLE_STORYBOARD: Storyboard = {
  version: 'v1',
  title: '루이의 오후 · 스토리보드 검수 샘플',
  noBgm: true,
  cuts: [
    {id: 'CUT01', title: '창가의 루이', absoluteStartSeconds: 0, absoluteEndSeconds: 6, shots: [
      {id: 'S1', startSeconds: 0, endSeconds: 2, startFrame: '따뜻한 오후 빛이 드는 거실 전경, 루이는 창가 왼쪽에 앉아 있다', endFrame: '루이의 귀가 바깥 소리를 향해 살짝 움직인다', camera: 'WIDE · 느린 PUSH-IN', action: '공간과 루이의 위치를 먼저 보여주고 작은 반응으로 시선을 유도한다', dialogue: '—', sfx: '커튼 스침 · 멀리서 새소리'},
      {id: 'S2', startSeconds: 2, endSeconds: 4, startFrame: '창밖을 보던 루이의 옆얼굴', endFrame: '루이가 카메라 쪽으로 고개를 돌려 눈을 맞춘다', camera: 'OTS → MEDIUM · 부드러운 ARC', action: '관찰하던 시선을 관객과의 교감으로 전환한다', dialogue: '오늘도 같이 갈까?', sfx: '목줄 금속이 가볍게 울리는 소리'},
      {id: 'S3', startSeconds: 4, endSeconds: 6, startFrame: '카메라와 눈을 맞춘 루이의 편안한 표정', endFrame: '루이가 화면 중앙에서 꼬리를 흔들며 엔딩 포즈를 유지한다', camera: 'CLOSE-UP → MEDIUM · PULL-BACK', action: '표정 클로즈업 뒤 전신 포즈로 마무리한다', dialogue: '—', sfx: '꼬리가 쿠션을 두드리는 소리'},
    ]},
    {id: 'CUT02', title: '산책의 시작', absoluteStartSeconds: 6, absoluteEndSeconds: 12, shots: [
      {id: 'S1', startSeconds: 0, endSeconds: 3, startFrame: '현관 앞에 놓인 목줄과 루이의 앞발', endFrame: '루이가 목줄을 입에 물고 고개를 든다', camera: 'TOP-DOWN → LOW ANGLE', action: '소품을 행동의 계기로 연결한다', dialogue: '—', sfx: '목줄 버클 소리'},
      {id: 'S2', startSeconds: 3, endSeconds: 6, startFrame: '문 앞에서 기다리는 루이', endFrame: '문이 열리고 따뜻한 역광 속으로 첫발을 내딛는다', camera: 'REVERSE DOLLY · 문 밖으로 이동', action: '실내에서 야외로 이동하며 다음 장면의 방향을 만든다', dialogue: '가자!', sfx: '문 열림 · 발걸음'},
    ]},
  ],
};

const EmptyState = ({title, description, action}: {title: string; description: string; action?: React.ReactNode}) => (
  <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-white/15 bg-white/[0.025] p-10 text-center">
    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-gray-300">아직 생성되지 않음</span>
    <h2 className="mt-4 text-xl font-black text-white text-balance">{title}</h2>
    <p className="mt-2 max-w-lg text-sm leading-6 text-gray-400 text-pretty">{description}</p>
    {action ? <div className="mt-6">{action}</div> : null}
  </div>
);

const BriefField = ({label, value, onChange, multiline = false}: {label: string; value: string; onChange: (value: string) => void; multiline?: boolean}) => <label className="block"><span className="text-xs font-black text-gray-400">{label}</span>{multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 text-white focus:border-fuchsia-400 focus:outline-none"/> : <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white focus:border-fuchsia-400 focus:outline-none"/>}</label>;

const DecisionPath = ({items}: {items: string[]}) => (
  <div className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="이 단계의 결정 순서">
    {items.map((item, index) => <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3"><span className="text-[10px] font-black text-fuchsia-300">{String(index + 1).padStart(2, '0')}</span><p className="mt-1 text-sm font-bold text-gray-200">{item}</p></div>)}
  </div>
);

export default function StageWorkspace({workspace, interviewBrief, characterSheet, characterSheets, storyboard, sampleMode, onEnableSample, onOpenEdit, onNavigate}: StageWorkspaceProps) {
  const dispatch = useAppDispatch();
  const projectState = useAppSelector((state) => state.projectState);
  const projectId = projectState.id;
  const workflow = projectState.workflow;
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
  const [isEditingBrief, setIsEditingBrief] = useState(false);
  const [briefDraft, setBriefDraft] = useState<InterviewBrief | undefined>(interviewBrief);
  const [confirmImageCredit, setConfirmImageCredit] = useState(false);
  const [retryCharacterId, setRetryCharacterId] = useState<string | null>(null);
  const [imageGenerationJobId, setImageGenerationJobId] = useState<string | null>(null);
  const [generationCharacterId, setGenerationCharacterId] = useState<string | null>(null);
  const [completedCharacterId, setCompletedCharacterId] = useState<string | null>(null);
  const [imageGenerationStatus, setImageGenerationStatus] = useState<'idle' | 'submitting' | 'queued' | 'processing' | 'completed' | 'failed'>('idle');
  const [storyboardJobId, setStoryboardJobId] = useState<string | null>(null);
  const [storyboardJobProjectId, setStoryboardJobProjectId] = useState<string | null>(null);
  const [storyboardJobStatus, setStoryboardJobStatus] = useState<'idle' | 'recovering' | 'queued' | 'processing' | 'completed' | 'failed' | 'stale'>('idle');
  const [storyboardError, setStoryboardError] = useState<string | null>(null);
  const [isLockingStyle, setIsLockingStyle] = useState(false);
  const [pendingStyleAnchorId, setPendingStyleAnchorId] = useState<string | null>(null);
  const workflowRef = useRef(workflow);
  const projectStateRef = useRef(projectState);
  const characterSheetsRef = useRef(allCharacterSheets);
  useEffect(() => { workflowRef.current = workflow; }, [workflow]);
  useEffect(() => { projectStateRef.current = projectState; }, [projectState]);
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
    const expectedWorkflow = workflowRef.current;
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
      const command = preparePlanningInstallCommand({
        expectedWorkflow,
        interviewBrief: payload.interviewBrief,
        styleBible: payload.styleBible,
        styleBibleHash: payload.styleBibleHash,
        characterSheets: parsedSheets,
        seedanceMaster: payload.seedanceMaster,
      });
      const stillCurrent = isPlanningRequestCurrent(workflowRef.current, command.expectedWorkflow);
      dispatch(installPlanningIfCurrent(command));
      if (stillCurrent) setShowRecompose(false);
      else setComposeError('AI 기획 중 프로젝트 내용이 변경되어 이전 요청의 결과를 적용하지 않았습니다. 현재 내용을 확인한 뒤 다시 요청하세요.');
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : 'AI 기획을 완료하지 못했습니다.');
    } finally {
      setIsComposing(false);
    }
  };

  const currentStoryboardInput = useMemo<StoryboardJobInput | undefined>(() => {
    if (!interviewBrief || !styleBible || !styleBibleHash || allCharacterSheets.length === 0
      || allCharacterSheets.some((sheet) => !sheet.referenceImageId || sheet.referenceStyleHash !== styleBibleHash)) return undefined;
    const parsed = storyboardJobInputSchema.safeParse({
      projectId,
      sentence: `${interviewBrief.subject}. ${interviewBrief.action}. ${interviewBrief.extraNotes ?? ''}`.trim(),
      interviewBrief,
      styleBible,
      styleBibleHash,
      characterSheets: allCharacterSheets,
    });
    return parsed.success ? parsed.data : undefined;
  }, [allCharacterSheets, interviewBrief, projectId, styleBible, styleBibleHash]);
  const storyboardJobBelongsToProject = storyboardJobProjectId === projectId;
  const currentStoryboardJobId = storyboardJobBelongsToProject ? storyboardJobId : null;
  const currentStoryboardJobStatus = storyboardJobBelongsToProject ? storyboardJobStatus : 'idle';
  const currentStoryboardError = storyboardJobBelongsToProject ? storyboardError : null;
  const storyboardBusy = ['recovering', 'queued', 'processing'].includes(currentStoryboardJobStatus);
  const storyboardPollControllerRef = useRef<AbortController | null>(null);

  const flushProjectChanges = useCallback((snapshot?: typeof projectState) => new Promise<number>((resolve, reject) => {
    window.dispatchEvent(new CustomEvent('clipjs:flush-project', {detail: {resolve, reject, snapshot}}));
  }), []);

  const persistCompletedStoryboardJob = useCallback(async (job: StoryboardJobResponse) => {
    if (job.status !== 'completed') throw new Error('완료되지 않은 콘티 작업입니다.');
    const snapshot = applyCompletedStoryboardJob(projectStateRef.current, job);
    const command = prepareCompletedStoryboardJobCommand(job);
    dispatch(installStoryboardIfCurrent(command));
    const revision = await flushProjectChanges(snapshot);
    if (projectStateRef.current.id !== projectId) return;
    applyCompletedStoryboardJob(projectStateRef.current, job);
    dispatch(acknowledgeProjectRevision({projectId, revision}));
    setStoryboardJobStatus('completed');
    setStoryboardError(null);
  }, [dispatch, flushProjectChanges, projectId]);

  const pollStoryboardJob = useCallback(async (jobId: string, signal: AbortSignal) => {
    while (!signal.aborted && projectStateRef.current.id === projectId) {
      setStoryboardJobStatus((current) => current === 'recovering' ? 'recovering' : 'processing');
      const response = await fetch('/api/vlog/storyboard', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({action: 'run', projectId, jobId}),
        cache: 'no-store',
        signal,
      });
      const raw = await response.json() as unknown;
      if (!response.ok) {
        const error = raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
          ? raw.error
          : '스토리보드 작업 상태를 불러오지 못했습니다.';
        throw new Error(error);
      }
      const job = storyboardJobResponseSchema.parse(raw);
      if (signal.aborted || projectStateRef.current.id !== projectId) return;
      setStoryboardJobId(job.jobId);
      if (job.status === 'completed') {
        await persistCompletedStoryboardJob(job);
        return;
      }
      if (job.status === 'failed') {
        setStoryboardJobStatus('failed');
        setStoryboardError(job.error ?? '스토리보드를 생성하지 못했습니다.');
        return;
      }
      setStoryboardJobStatus(job.status);
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 1500);
        signal.addEventListener('abort', () => {
          window.clearTimeout(timeout);
          resolve();
        }, {once: true});
      });
    }
  }, [persistCompletedStoryboardJob, projectId]);

  const startStoryboardPolling = useCallback((jobId: string, recovering = false) => {
    storyboardPollControllerRef.current?.abort();
    const controller = new AbortController();
    storyboardPollControllerRef.current = controller;
    setStoryboardJobId(jobId);
    setStoryboardJobProjectId(projectId);
    setStoryboardJobStatus(recovering ? 'recovering' : 'queued');
    void pollStoryboardJob(jobId, controller.signal).catch((error) => {
      if (controller.signal.aborted || projectStateRef.current.id !== projectId) return;
      if (error instanceof Error && error.name === 'StaleStoryboardJobError') {
        setStoryboardJobStatus('stale');
        setStoryboardError('작업 중 기획 또는 캐릭터 기준이 변경되어 이전 콘티를 적용하지 않았습니다. 현재 내용으로 다시 생성하세요.');
        return;
      }
      setStoryboardJobStatus('failed');
      setStoryboardError(error instanceof Error ? error.message : '스토리보드 작업을 복구하지 못했습니다.');
    });
  }, [pollStoryboardJob, projectId]);

  useEffect(() => () => storyboardPollControllerRef.current?.abort(), []);

  useEffect(() => {
    if (sampleMode || storyboardIsCurrent || !currentStoryboardInput || currentStoryboardJobId) return;
    const controller = new AbortController();
    void fetch(`/api/vlog/storyboard?projectId=${encodeURIComponent(projectId)}`, {cache: 'no-store', signal: controller.signal})
      .then(async (response) => {
        if (controller.signal.aborted || projectStateRef.current.id !== projectId) return;
        if (response.status === 404) {
          setStoryboardJobStatus('idle');
          return;
        }
        const raw = await response.json() as unknown;
        if (!response.ok) throw new Error('저장된 콘티 작업을 확인하지 못했습니다.');
        const job = storyboardJobResponseSchema.parse(raw);
        if (JSON.stringify(job.input) !== JSON.stringify(currentStoryboardInput)) {
          setStoryboardJobStatus('idle');
          return;
        }
        if (job.status === 'failed') {
          setStoryboardJobId(job.jobId);
          setStoryboardJobProjectId(projectId);
          setStoryboardJobStatus('failed');
          setStoryboardError(job.error ?? '이전 콘티 작업이 실패했습니다.');
          return;
        }
        startStoryboardPolling(job.jobId, true);
      })
      .catch((error) => {
        if (controller.signal.aborted || projectStateRef.current.id !== projectId) return;
        setStoryboardJobStatus('failed');
        setStoryboardError(error instanceof Error ? error.message : '저장된 콘티 작업을 확인하지 못했습니다.');
      });
    return () => controller.abort();
  }, [currentStoryboardInput, currentStoryboardJobId, projectId, sampleMode, startStoryboardPolling, storyboardIsCurrent]);

  const generateStoryboard = async () => {
    if (!currentStoryboardInput || storyboardBusy) return;
    setStoryboardError(null);
    setStoryboardJobProjectId(projectId);
    setStoryboardJobStatus('queued');
    onNavigate('storyboard');
    try {
      await flushProjectChanges();
      const response = await fetch('/api/vlog/storyboard', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(currentStoryboardInput),
      });
      const raw = await response.json() as unknown;
      if (!response.ok) {
        const error = raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
          ? raw.error
          : '스토리보드 작업을 저장하지 못했습니다.';
        throw new Error(error);
      }
      const job = storyboardJobResponseSchema.parse(raw);
      startStoryboardPolling(job.jobId);
    } catch (error) {
      if (projectStateRef.current.id !== projectId) return;
      setStoryboardJobStatus('failed');
      setStoryboardError(error instanceof Error ? error.message : '스토리보드 작업을 시작하지 못했습니다.');
    }
  };

  const saveBriefDraft = () => {
    const parsed = interviewBriefSchema.safeParse(briefDraft);
    if (!parsed.success) {
      setComposeError('주제·장면·길이·분위기·대사를 모두 확인해 주세요.');
      return;
    }
    dispatch(setWorkflow(invalidateForCreativeChange({
      ...workflowRef.current,
      planningStatus: 'draft',
      interviewBrief: parsed.data,
      storyboard: undefined,
    })));
    setComposeError(null);
    setIsEditingBrief(false);
  };

  const startCharacterImageGeneration = async () => {
    if (!activeCharacter?.id || !styleBible || !styleBibleHash || !confirmImageCredit || ['submitting', 'queued', 'processing'].includes(imageGenerationStatus)) return;
    const targetCharacterId = activeCharacter.id;
    setCharacterUploadError(null);
    setGenerationCharacterId(targetCharacterId);
    setCompletedCharacterId(null);
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
        body: JSON.stringify({characterId: targetCharacterId, prompt, styleBibleHash, styleReferenceImageIds, confirmCreditCost: 1}),
      });
      const payload = await response.json() as {jobId?: string; error?: string};
      if (!response.ok || !payload.jobId) throw new Error(payload.error ?? '이미지 생성 요청 실패');
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
          setCompletedCharacterId(generationCharacterId);
          setImageGenerationJobId(null);
          setGenerationCharacterId(null);
          setRetryCharacterId(null);
          setImageGenerationStatus('completed');
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
              <p className="text-xs font-black uppercase tracking-[0.22em] text-fuchsia-300">1 · 아이디어 입력</p>
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
                {isEditingBrief && briefDraft ? <div className="mt-6 rounded-2xl border border-fuchsia-400/25 bg-black/20 p-5"><div className="grid gap-4 sm:grid-cols-2"><BriefField label="영상의 주제" value={briefDraft.subject} onChange={(subject) => setBriefDraft({...briefDraft, subject})}/><BriefField label="분위기" value={briefDraft.tone} onChange={(tone) => setBriefDraft({...briefDraft, tone})}/></div><div className="mt-4"><BriefField label="장면에서 일어나는 일" value={briefDraft.action} onChange={(action) => setBriefDraft({...briefDraft, action})} multiline/></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="block"><span className="text-xs font-black text-gray-400">영상 길이</span><select value={briefDraft.durationSeconds} onChange={(event) => setBriefDraft({...briefDraft, durationSeconds: Number(event.target.value) as 20 | 30})} className="mt-2 w-full rounded-xl border border-white/10 bg-[#141218] px-4 py-3 text-sm text-white"><option value={20}>20초</option><option value={30}>30초</option></select></label><BriefField label="핵심 대사" value={briefDraft.greetingLine} onChange={(greetingLine) => setBriefDraft({...briefDraft, greetingLine})}/></div><div className="mt-4"><BriefField label="추가 요청" value={briefDraft.extraNotes ?? ''} onChange={(extraNotes) => setBriefDraft({...briefDraft, extraNotes})} multiline/></div><p className="mt-4 text-xs leading-5 text-amber-200">저장하면 현재 스토리보드와 이후 승인은 취소되며, 수정한 기획을 다시 확인해야 합니다.</p><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => { setBriefDraft(interviewBrief); setIsEditingBrief(false); setComposeError(null); }} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-black text-white">취소</button><button type="button" onClick={saveBriefDraft} className="rounded-xl bg-fuchsia-500 px-4 py-2.5 text-sm font-black text-white">수정 내용 저장</button></div></div> : <><p className="mt-7 text-xs font-black uppercase tracking-[0.18em] text-fuchsia-300">제작 브리프</p>
                <div className="mt-3 flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-3xl font-black text-white">{interviewBrief.subject}</h2><p className="mt-3 max-w-2xl text-base leading-7 text-gray-300">{interviewBrief.action}</p></div><button type="button" onClick={() => { setBriefDraft(interviewBrief); setIsEditingBrief(true); }} className="rounded-xl border border-fuchsia-400/30 px-4 py-2.5 text-sm font-black text-fuchsia-100">브리프 직접 수정</button></div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-black/20 p-4"><div className="text-xs text-gray-500">길이</div><div className="mt-1 text-lg font-black text-white">{interviewBrief.durationSeconds}초</div></div><div className="rounded-2xl bg-black/20 p-4"><div className="text-xs text-gray-500">분위기</div><div className="mt-1 text-sm font-bold text-white">{interviewBrief.tone}</div></div><div className="rounded-2xl bg-black/20 p-4"><div className="text-xs text-gray-500">핵심 대사</div><div className="mt-1 text-sm font-bold text-white">{interviewBrief.greetingLine || '대사 없음'}</div></div></div>{interviewBrief.extraNotes ? <div className="mt-3 rounded-2xl bg-black/20 p-4"><p className="text-xs text-gray-500">추가 요청</p><p className="mt-2 text-sm leading-6 text-gray-300">{interviewBrief.extraNotes}</p></div> : null}</>}
                <div className={`mt-7 rounded-2xl border p-5 ${planningApproved ? 'border-fuchsia-400/25 bg-fuchsia-500/[0.08]' : 'border-amber-400/25 bg-amber-400/[0.07]'}`}><p className="text-sm font-black text-white">{planningApproved ? '다음으로 캐릭터 기준을 만드세요' : '이 내용으로 영상을 만들지 직접 결정하세요'}</p><p className="mt-1 text-sm text-gray-400">{planningApproved ? '확정한 캐릭터 설정을 기준으로 실제 이미지를 선택하고 만듭니다.' : '주제·행동·길이·분위기·대사를 확인하세요. 마음에 들지 않으면 새 문장으로 다시 만들 수 있습니다.'}</p>{planningApproved ? <button type="button" onClick={() => onNavigate('reference')} className="mt-4 rounded-xl bg-fuchsia-500 px-5 py-3 text-sm font-black text-white hover:bg-fuchsia-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300">다음: 캐릭터 기준 만들기 →</button> : <div className="mt-4 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => { setSentence(''); setShowRecompose(true); }} className="rounded-xl border border-white/15 px-5 py-3 text-sm font-black text-white">내용 바꿔서 다시 만들기</button><button type="button" onClick={() => dispatch(setPlanningStatus('approved'))} className="rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-black">검수 완료 · 이 기획 확정</button></div>}</div>
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
    const useSampleReference = shouldUseSampleFallback(sampleMode, allCharacterSheets.length > 0);
    const displayed = activeCharacter ?? (useSampleReference ? SAMPLE_CHARACTER : undefined);
    const activeKey = displayed ? displayed.id ?? displayed.name : '';
    const activePreviewUrl = characterPreviewUrls[activeKey];
    const readyCount = allCharacterSheets.filter((sheet) => sheet.referenceImageId).length;
    const anchorCandidates = allCharacterSheets.filter((sheet) => sheet.referenceImageId && sheet.referenceStyleHash === workflow.styleBibleHash && (sheet.styleReferenceImageIds ?? []).length === 0);
    const anchorReferenceId = anchorCandidates.length === 1 ? anchorCandidates[0].referenceImageId : undefined;
    const isSheetStyleLocked = (sheet: CharacterSheet) => Boolean(anchorReferenceId && sheet.referenceStyleHash === workflow.styleBibleHash && (sheet.referenceImageId === anchorReferenceId || (sheet.styleReferenceImageIds ?? []).includes(anchorReferenceId)));
    const styleLockedCount = allCharacterSheets.filter(isSheetStyleLocked).length;
    const activeStyleLocked = activeCharacter ? isSheetStyleLocked(activeCharacter) : false;
    const totalCount = allCharacterSheets.length;
    const generationBusy = ['submitting', 'queued', 'processing'].includes(imageGenerationStatus);
    const generationCharacter = allCharacterSheets.find((sheet) => (sheet.id ?? sheet.name) === generationCharacterId);
    const completedCharacter = allCharacterSheets.find((sheet) => (sheet.id ?? sheet.name) === completedCharacterId);
    return (
      <section className="h-full overflow-y-auto bg-[#0c0b10] p-6 lg:p-10">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-fuchsia-300">2 · 캐릭터·스타일</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div><h1 className="text-3xl font-black text-white">출연 캐릭터별 기준을 고정합니다</h1><p className="mt-2 text-sm text-gray-400">메인 캐릭터마다 별도 기준 이미지가 필요합니다. 강아지와 다람쥐라면 각각 한 장씩 준비합니다.</p></div>
            {totalCount ? <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"><div className="text-right"><p className="text-xs text-gray-500">이미지 · 스타일 잠금</p><p className="mt-1 text-xl font-black text-white">{readyCount}/{totalCount} · {styleLockedCount}/{totalCount}</p></div></div> : null}
          </div>
          <DecisionPath items={['캐릭터별 기준 이미지 준비', '기준 후보의 전체 영향 확인', 'Style Bible·대표 기준 화풍 확정', '나머지 캐릭터 동일 화풍 검수']}/>
          <div className="mt-4 rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/[0.06] p-4"><p className="text-sm font-black text-fuchsia-100">현재 구현의 확정 경계</p><p className="mt-2 text-xs leading-5 text-gray-300">기준 이미지 1장을 프로젝트 대표 기준 화풍으로 채택할 때 Style Bible도 함께 확정됩니다. 확정 전에는 다른 캐릭터의 유료 동일 화풍 생성을 시작하지 않습니다.</p></div>
          {generationBusy ? <div role="status" aria-live="polite" className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-fuchsia-400/35 bg-fuchsia-500/[0.10] p-5"><div className="flex items-center gap-4"><span className="h-4 w-4 animate-pulse rounded-full bg-fuchsia-300"/><div><p className="text-sm font-black text-fuchsia-200">{generationCharacter?.name ?? '선택한 캐릭터'} 기준 이미지를 만들고 있습니다</p><p className="mt-1 text-sm text-gray-300">완료될 때까지 다른 캐릭터를 선택할 수 없습니다.</p></div></div><span className="rounded-full bg-fuchsia-300 px-3 py-1.5 text-xs font-black text-black">{imageGenerationStatus === 'submitting' ? '요청 전송 중' : imageGenerationStatus === 'queued' ? '생성 대기 중' : '이미지 생성 중'}</span></div> : null}
          {imageGenerationStatus === 'completed' ? <div role="status" className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-emerald-400/30 bg-emerald-400/[0.08] p-5"><div><p className="text-sm font-black text-emerald-200">✓ {completedCharacter?.name ?? '선택한 캐릭터'}의 새 기준 이미지가 도착했습니다</p><p className="mt-1 text-sm text-gray-300">크게 확인한 뒤 마음에 들면 계속 진행하고, 마음에 들지 않으면 다시 만들거나 인터뷰를 수정하세요.</p></div><button type="button" onClick={() => setImageGenerationStatus('idle')} className="rounded-xl border border-emerald-300/30 px-4 py-2 text-sm font-black text-emerald-100">확인했습니다</button></div> : null}
          {!displayed ? <div className="mt-8"><EmptyState title="기준 시트가 없습니다" description="인터뷰에서 AI 기획을 완료하세요. AI가 주요 출연 캐릭터를 분리해 각각의 기준 시트를 만듭니다."/></div> : (
            <>
              {!useSampleReference && allCharacterSheets.length > 0 ? <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{allCharacterSheets.map((sheet, index) => {
                const key = sheet.id ?? sheet.name;
                const selected = key === activeKey;
                const preview = characterPreviewUrls[key];
                const lockedByGeneration = generationBusy && key !== generationCharacterId;
                return <button key={key} type="button" disabled={lockedByGeneration} title={lockedByGeneration ? `${generationCharacter?.name ?? '다른 캐릭터'} 이미지 생성이 끝난 뒤 선택할 수 있습니다.` : undefined} onClick={() => { if (generationBusy) return; setActiveCharacterId(key); setCharacterUploadError(null); setConfirmImageCredit(false); if (imageGenerationStatus === 'completed') setImageGenerationStatus('idle'); }} className={`overflow-hidden rounded-2xl border text-left transition disabled:cursor-wait disabled:opacity-45 ${selected ? 'border-fuchsia-400 bg-fuchsia-500/[0.10] shadow-[0_0_35px_rgba(217,70,239,0.12)]' : 'border-white/10 bg-[#15131a] hover:border-white/25'}`}>
                  <div className="flex items-center gap-4 p-4">{preview ? <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-black"><Image src={preview} alt={`${sheet.name} 미리보기`} fill unoptimized className="object-cover" sizes="96px" onLoad={() => { previewFailures.current[key] = 0; }} onError={() => { previewFailures.current[key] = (previewFailures.current[key] ?? 0) + 1; setCharacterPreviewUrls((current) => { const next = {...current}; delete next[key]; return next; }); }}/></div> : <div className="grid h-16 w-24 shrink-0 place-items-center rounded-xl border border-dashed border-white/15 bg-black/30 text-xl text-fuchsia-300">✦</div>}<div className="min-w-0"><p className="text-[11px] font-black text-fuchsia-300">캐릭터 {index + 1}</p><p className="mt-1 truncate text-lg font-black text-white">{sheet.name}</p><p className={`mt-1 text-xs font-bold ${isSheetStyleLocked(sheet) ? 'text-emerald-300' : sheet.referenceImageId ? 'text-amber-300' : 'text-red-300'}`}>{isSheetStyleLocked(sheet) ? sheet.referenceImageId === anchorReferenceId ? '✓ 프로젝트 스타일 기준' : '✓ 스타일 잠금 완료' : sheet.referenceImageId ? '스타일 검수 필요' : '기준 이미지 필요'}</p></div></div>
                </button>;
              })}</div> : null}

              <div className="mt-5 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
                <article className="overflow-hidden rounded-3xl border border-white/10 bg-[#15131a]">
                  {useSampleReference ? <><div className="border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-bold text-amber-200">샘플 전용 · 현재 프로젝트의 승인 대상이 아닙니다</div><div className="relative aspect-[16/10] bg-black"><Image src="/mock-assets/reference-shiba.webp" alt="샘플 시바견 마스터 시트" fill className="object-contain" sizes="70vw" priority/></div></> : activePreviewUrl ? <><div className={`border-b px-4 py-3 text-xs font-bold ${activeStyleLocked ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-amber-400/20 bg-amber-400/10 text-amber-100'}`}>{activeStyleLocked ? `✓ ${displayed.name} · 프로젝트 스타일 잠금 완료` : workflow.styleBibleHash ? `${displayed.name} · 현재 프로젝트 스타일과 일치 확인이 필요합니다` : <span className="flex flex-wrap items-center justify-between gap-3"><span>{displayed.name} · 기존 이미지는 아직 공통 스타일 기준이 아닙니다</span><button type="button" disabled={isLockingStyle} onClick={() => setPendingStyleAnchorId(displayed.referenceImageId ?? null)} className="rounded-lg bg-amber-300 px-3 py-1.5 font-black text-black disabled:opacity-50">이 이미지를 스타일 기준으로 선택</button></span>}</div><div className="relative aspect-[16/10] bg-black"><Image src={activePreviewUrl} alt={`${displayed.name} 기준 이미지`} fill unoptimized className="object-contain" sizes="70vw" onLoad={() => { previewFailures.current[activeKey] = 0; }} onError={() => { previewFailures.current[activeKey] = (previewFailures.current[activeKey] ?? 0) + 1; setCharacterPreviewUrls((current) => { const next = {...current}; delete next[activeKey]; return next; }); }}/></div>{workflow.styleBibleHash && !activeStyleLocked ? <div className="border-t border-fuchsia-400/20 bg-fuchsia-500/[0.06] p-4"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-black text-white">프로젝트 스타일로 다시 생성</p><p className="mt-1 text-xs text-gray-400">잠긴 Master Sheet {styleReferenceImageIds.length}장을 실제 이미지 reference로 사용합니다.</p></div><span className="rounded-full bg-amber-400/15 px-3 py-1 text-xs font-black text-amber-200">1 credit</span></div><label className="mt-3 flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3"><input type="checkbox" className="mt-0.5 accent-fuchsia-500" checked={confirmImageCredit} onChange={(event) => setConfirmImageCredit(event.target.checked)}/><span className="text-xs leading-5 text-gray-300">{displayed.name} 기존 이미지는 보존하고, 스타일 일치 이미지 1장을 새로 생성하는 데 1 credit 사용을 확인합니다.</span></label><button type="button" disabled={!confirmImageCredit || styleReferenceImageIds.length === 0 || ['submitting', 'queued', 'processing'].includes(imageGenerationStatus)} onClick={() => void startCharacterImageGeneration()} className="mt-3 w-full rounded-xl bg-fuchsia-500 px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{imageGenerationStatus === 'submitting' ? '제출 중…' : imageGenerationStatus === 'queued' || imageGenerationStatus === 'processing' ? '스타일 일치 이미지 생성 중…' : `${displayed.name} 다시 생성`}</button></div> : null}</> : <div className="flex aspect-[16/10] flex-col items-center justify-center border-b border-dashed border-white/10 bg-black/40 px-8 text-center"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-fuchsia-500/15 text-2xl">✦</div><p className="mt-4 text-lg font-black text-white">{displayed.name} 기준 이미지를 만드세요</p><p className="mt-2 max-w-md text-sm leading-6 text-gray-500">현재 선택한 캐릭터만 생성합니다. 다른 캐릭터는 위 카드에서 따로 선택해 준비합니다.</p><div className="mt-5 w-full max-w-xl rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/[0.07] p-4 text-left"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-black text-white">Higgsfield AI 캐릭터 이미지</p><p className="mt-1 text-xs leading-5 text-gray-400">Nano Banana 2 Lite · 1K · 16:9 · 1장</p></div><span className="shrink-0 rounded-full bg-amber-400/15 px-3 py-1 text-xs font-black text-amber-200">1 credit</span></div><label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3"><input type="checkbox" className="mt-0.5 accent-fuchsia-500" checked={confirmImageCredit} disabled={['submitting', 'queued', 'processing'].includes(imageGenerationStatus)} onChange={(event) => { setConfirmImageCredit(event.target.checked); if (imageGenerationStatus === 'failed') setImageGenerationStatus('idle'); }}/><span className="text-xs leading-5 text-gray-300">{displayed.name} 이미지 1장 생성에 1 credit 사용을 확인합니다.</span></label><button type="button" disabled={!confirmImageCredit || ['submitting', 'queued', 'processing'].includes(imageGenerationStatus)} onClick={() => void startCharacterImageGeneration()} className="mt-3 w-full rounded-xl bg-fuchsia-500 px-4 py-2.5 text-sm font-black text-white hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40">{imageGenerationStatus === 'submitting' ? '제출 중…' : imageGenerationStatus === 'queued' || imageGenerationStatus === 'processing' ? '이미지 생성 처리 중…' : imageGenerationStatus === 'failed' ? '1 credit으로 다시 생성' : `${displayed.name} 이미지 생성`}</button></div></div>}
                  {pendingStyleAnchorId === displayed.referenceImageId && !workflow.styleBibleHash ? <div className="border-t border-amber-300/25 bg-amber-300/[0.08] p-4"><p className="text-sm font-black text-amber-100">이 화풍을 프로젝트 전체 기준으로 사용할까요?</p><p className="mt-2 text-xs leading-5 text-amber-50/70">확정하면 {displayed.name} 이미지는 기준으로 보존되고, 나머지 {Math.max(0, totalCount - 1)}명은 같은 화풍으로 다시 만들어야 합니다. 예상 추가 비용은 최대 {Math.max(0, totalCount - 1)} credit입니다.</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => setPendingStyleAnchorId(null)} className="flex-1 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-black text-white">다른 이미지 비교</button><button type="button" disabled={isLockingStyle} onClick={() => void lockActiveReferenceAsProjectStyle()} className="flex-1 rounded-xl bg-amber-300 px-4 py-2.5 text-sm font-black text-black disabled:opacity-50">{isLockingStyle ? '확정 중…' : `${displayed.name} 화풍으로 확정`}</button></div></div> : null}
                  {activePreviewUrl && displayed.referenceImageId ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 p-4"><div><p className="text-sm font-black text-white">이 이미지가 마음에 드나요?</p><p className="mt-1 text-xs text-gray-500">결과를 직접 확인한 뒤 계속 진행하거나 다시 만드세요.</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={generationBusy} onClick={() => onNavigate('interview')} className="rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-gray-200 disabled:opacity-40">인터뷰 수정</button><button type="button" disabled={generationBusy} onClick={() => { if (displayed.referenceImageId === anchorReferenceId) { setCharacterUploadError('이 이미지는 프로젝트 전체 화풍 기준입니다. 먼저 다른 이미지를 등록해 비교한 뒤 새 기준으로 확정하거나 인터뷰를 수정해 주세요.'); return; } setRetryCharacterId(activeKey); setConfirmImageCredit(false); setImageGenerationStatus('idle'); setCharacterUploadError(null); }} className="rounded-xl border border-fuchsia-400/30 px-4 py-2 text-sm font-black text-fuchsia-200 disabled:opacity-40">다시 만들기</button><label className={`cursor-pointer rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-gray-200 hover:border-fuchsia-400/60 hover:text-white ${isUploadingCharacter || generationBusy ? 'pointer-events-none opacity-50' : ''}`}>{isUploadingCharacter ? '등록 중…' : '다른 이미지 등록'}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void uploadCharacterReference(file); event.currentTarget.value = ''; }}/></label></div></div> : <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 p-4"><div><p className="text-sm font-black text-white">기준 이미지를 준비하세요</p><p className="mt-1 text-xs text-gray-500">AI로 1장을 만들거나 보유 이미지를 직접 등록할 수 있습니다.</p></div><label className={`cursor-pointer rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-gray-200 hover:border-fuchsia-400/60 hover:text-white ${isUploadingCharacter || generationBusy ? 'pointer-events-none opacity-50' : ''}`}>{isUploadingCharacter ? '등록 중…' : `${displayed.name} 이미지 등록`}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void uploadCharacterReference(file); event.currentTarget.value = ''; }}/></label></div>}
                  {retryCharacterId === activeKey && activePreviewUrl && displayed.referenceImageId !== anchorReferenceId ? <div className="border-t border-fuchsia-400/25 bg-fuchsia-500/[0.07] p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-black text-white">{displayed.name} 이미지를 다시 만들까요?</p><p className="mt-1 text-xs leading-5 text-gray-400">현재 이미지는 새 결과가 안전하게 등록될 때까지 보존됩니다.</p></div><span className="rounded-full bg-amber-400/15 px-3 py-1 text-xs font-black text-amber-200">1 credit · 1장</span></div><label className="mt-4 flex items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3"><input type="checkbox" checked={confirmImageCredit} onChange={(event) => setConfirmImageCredit(event.target.checked)} className="mt-0.5 accent-fuchsia-500"/><span className="text-xs leading-5 text-gray-300">Nano Banana 2 Lite · 1K · 16:9로 새 이미지 1장을 생성하는 데 1 credit 사용을 확인합니다.</span></label><div className="mt-3 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => { setRetryCharacterId(null); setConfirmImageCredit(false); }} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-black text-white">현재 이미지 유지</button><button type="button" disabled={!confirmImageCredit || styleReferenceImageIds.length === 0 || generationBusy} onClick={() => void startCharacterImageGeneration()} className="rounded-xl bg-fuchsia-500 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40">{generationBusy ? '생성 중…' : '1 credit으로 다시 생성'}</button></div></div> : null}
                  {characterUploadError ? <p className="border-t border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-xs text-red-200">{characterUploadError}</p> : null}
                </article>
                <aside className="rounded-3xl border border-white/10 bg-[#15131a] p-6"><p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-300">선택한 캐릭터</p><h2 className="mt-2 text-xl font-black text-white">{displayed.name}</h2><p className="mt-1 text-sm text-gray-400">{displayed.breed ?? '캐릭터 기준'}</p><div className="mt-5 flex flex-wrap gap-2">{displayed.visualTags.map((tag) => <span key={tag} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-300">{tag}</span>)}</div><div className="mt-8 space-y-3">{Object.entries(displayed.palette).map(([label, color]) => <div key={label} className="flex items-center gap-3"><span className="h-9 w-9 rounded-xl border border-white/10" style={{backgroundColor: color}}/><span className="text-sm text-gray-300">{label}</span><code className="ml-auto text-xs text-gray-500">{color}</code></div>)}</div></aside>
              </div>

              {!useSampleReference ? <>
                <div className={`mt-8 rounded-3xl border p-6 ${progress.state === 'character-ready' ? 'border-emerald-400/30 bg-gradient-to-r from-emerald-500/[0.10] to-fuchsia-500/[0.08]' : 'border-amber-400/25 bg-amber-400/[0.06]'}`}><p className={`text-xs font-black uppercase tracking-[0.18em] ${progress.state === 'character-ready' ? 'text-emerald-200' : 'text-amber-200'}`}>전체 캐릭터 검수</p><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{allCharacterSheets.map((sheet) => <div key={sheet.id ?? sheet.name} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3"><span className="text-sm font-bold text-white">{sheet.name}</span><span className={`text-xs font-black ${isSheetStyleLocked(sheet) ? 'text-emerald-300' : 'text-amber-200'}`}>{isSheetStyleLocked(sheet) ? '✓ 이미지·화풍 확정' : sheet.referenceImageId ? '화풍 확인 필요' : '이미지 필요'}</span></div>)}</div>{progress.state !== 'character-ready' ? <div className="mt-5"><h2 className="text-xl font-black text-white">아직 전체 확정할 수 없습니다</h2><p className="mt-2 text-sm leading-6 text-gray-300">{readyCount < totalCount ? `기준 이미지가 없는 캐릭터 ${totalCount - readyCount}명을 먼저 준비하세요.` : `프로젝트 화풍과 일치하지 않는 캐릭터 ${totalCount - styleLockedCount}명을 다시 만들거나 새 이미지로 교체하세요.`}</p></div> : storyboard ? <div className="mt-5 flex flex-wrap items-center justify-between gap-5"><div><p className="text-sm font-black text-emerald-200">✓ 모든 캐릭터를 직접 확인했습니다</p><h2 className="mt-2 text-2xl font-black text-white">{storyboard.cuts.length}컷 스토리 콘티 검수</h2></div><button type="button" onClick={() => onNavigate('storyboard')} className="rounded-xl bg-fuchsia-500 px-6 py-3.5 text-sm font-black text-white">스토리 콘티 검수 →</button></div> : <div className="mt-5 flex flex-wrap items-center justify-between gap-5"><div><p className="text-sm font-black text-emerald-200">✓ 모든 캐릭터의 이미지와 화풍을 확인했습니다</p><h2 className="mt-2 text-2xl font-black text-white">이 기준으로 스토리 콘티를 만듭니다</h2><p className="mt-1 text-sm text-gray-300">다음 화면에서 컷별 화면·행동·카메라·대사를 직접 검수할 수 있습니다.</p></div><button type="button" disabled={storyboardBusy} onClick={() => void generateStoryboard()} className="rounded-xl bg-fuchsia-500 px-6 py-3.5 text-sm font-black text-white disabled:opacity-50">{storyboardBusy ? '스토리 콘티 생성 중…' : '전체 확정 · 스토리 콘티 생성 →'}</button></div>}</div>
              </> : null}
            </>
          )}
        </div>
      </section>
    );
  }

  if (workspace === 'storyboard') {
    const displayedStoryboard = storyboard ?? (sampleMode ? SAMPLE_STORYBOARD : undefined);
    const cuts = displayedStoryboard?.cuts ?? [];
    return (
      <section className="h-full overflow-y-auto bg-[#0c0b10] p-6 lg:p-10">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-fuchsia-300">3 · 콘티·승인</p>
          <h1 className="mt-2 text-3xl font-black text-white">장면의 흐름을 검수합니다</h1>
          <p className="mt-2 text-sm text-gray-400">이미지가 없는 실제 컷에는 빈 상태를 표시합니다. 샘플 이미지는 승인 해시에 포함되지 않습니다.</p>
          <DecisionPath items={['콘티 생성', '컷·샷 직접 검수', '필요한 컷 수정', '현재 버전 콘티 전체 승인']}/>
          {storyboardBusy ? <div role="status" aria-live="polite" className="mt-8 flex min-h-80 flex-col items-center justify-center rounded-3xl border border-fuchsia-400/30 bg-fuchsia-500/[0.07] p-10 text-center"><span className="h-12 w-12 animate-pulse rounded-full border-4 border-fuchsia-300 border-t-transparent"/><p className="mt-6 text-xl font-black text-white">스토리 콘티를 구성하고 있습니다</p><p className="mt-2 max-w-xl text-sm leading-6 text-gray-300">작업 상태는 안전하게 저장됩니다. 이 화면을 닫거나 새로고침해도 같은 프로젝트에서 진행 상태와 결과를 복구합니다.</p></div> : currentStoryboardError && !cuts.length ? <div className="mt-8"><EmptyState title="스토리보드를 만들지 못했습니다" description={currentStoryboardError} action={<div className="flex flex-wrap justify-center gap-3"><button type="button" onClick={() => onNavigate('reference')} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-black text-white">기준 시트 확인</button><button type="button" onClick={() => void generateStoryboard()} className="rounded-xl bg-fuchsia-500 px-4 py-2.5 text-sm font-black text-white">스토리보드 다시 시도</button></div>}/></div> : !cuts.length ? <div className="mt-8">{progress.state === 'character-ready' ? <div className="rounded-3xl border border-fuchsia-400/25 bg-fuchsia-500/[0.08] p-8 text-center"><h2 className="text-2xl font-black text-white">기준 이미지 검수가 끝났습니다</h2><p className="mt-3 text-sm leading-6 text-gray-400">확정한 캐릭터 이미지와 프로젝트 화풍을 입력으로 스토리 콘티를 만듭니다. 생성 후 컷별 화면·행동·카메라·대사를 직접 수정하고 승인할 수 있습니다.</p><button type="button" onClick={() => void generateStoryboard()} className="mt-5 rounded-xl bg-fuchsia-500 px-6 py-3 text-sm font-black text-white">스토리 콘티 생성</button></div> : <div className="rounded-3xl border border-amber-400/25 bg-amber-400/[0.07] p-8 text-center"><h2 className="text-2xl font-black text-white">캐릭터 검수가 아직 끝나지 않았습니다</h2><p className="mt-3 text-sm leading-6 text-gray-300">{progress.state === 'style-review-needed' ? `프로젝트 화풍과 일치하지 않는 캐릭터 ${Math.max(0, characterCount - styleConfirmedCharacterCount)}명이 남았습니다.` : `기준 이미지가 없는 캐릭터 ${Math.max(0, characterCount - readyCharacterCount)}명이 남았습니다.`}</p><p className="mt-1 text-xs text-gray-500">기준 시트에서 이미지를 직접 확인하고 확정해야 스토리 콘티를 만들 수 있습니다.</p><button type="button" onClick={() => onNavigate('reference')} className="mt-5 rounded-xl bg-amber-300 px-6 py-3 text-sm font-black text-black">기준 시트로 돌아가기</button></div>}</div> : displayedStoryboard ? <><div className={`mt-8 rounded-3xl border p-5 ${storyboard ? 'border-emerald-400/25 bg-emerald-400/[0.07]' : 'border-amber-400/25 bg-amber-400/[0.06]'}`}><p className={`text-sm font-black ${storyboard ? 'text-emerald-200' : 'text-amber-100'}`}>{storyboard ? `✓ ${storyboard.cuts.length}개 컷의 스토리 콘티가 준비됐습니다` : '샘플 검토 모드 · 실제 프로젝트 데이터와 분리'}</p><p className="mt-2 text-sm text-gray-300">전체 흐름을 먼저 확인한 뒤 컷을 선택해 START→END, 카메라, 행동, 대사와 SFX를 샷 단위로 검수하세요.</p></div><StoryboardStudio storyboard={displayedStoryboard} characterSheets={storyboard ? allCharacterSheets : []} reviewOnly={!storyboard}/></> : null}
        </div>
      </section>
    );
  }

  if (workspace === 'generation') {
    const useSampleGeneration = shouldUseSampleFallback(sampleMode, workflow.production.takes.length > 0);
    return (
      <section className="h-full overflow-y-auto bg-[#0c0b10] p-6 lg:p-10">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-fuchsia-300">4 · 생성·검수</p>
          <h1 className="mt-2 text-3xl font-black text-white">승인된 입력만 생성합니다</h1>
          <p className="mt-2 text-sm text-gray-400">사양과 실제 견적을 확인한 뒤 생성 실행을 별도로 승인하고, 유료 제출 후 도착한 생성본을 다시 승인하거나 반려합니다.</p>
          <DecisionPath items={['사양·실제 견적 확인', '생성 실행 승인', '유료 제출·상태 확인', '생성본 승인·반려']}/>
          <div className="mt-8"><TakeStudio reviewOnly={sampleMode}/></div>
          {useSampleGeneration ? <section className="mt-10 border-t border-white/10 pt-8" aria-label="생성 결과 UI 체험"><div className="mb-4 rounded-2xl border border-amber-400/25 bg-amber-400/[0.08] p-4"><p className="text-sm font-black text-amber-200">아래는 결과 검수 UI 체험용 샘플입니다</p><p className="mt-2 text-xs leading-5 text-amber-100/70">현재 프로젝트의 생성 진행·Take·승인 상태와 무관하며, 프로젝트 자산 ID와 해시가 없어 승인하거나 타임라인에 연결할 수 없습니다.</p></div><article className="overflow-hidden rounded-3xl border border-white/10 bg-black"><div className="border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-bold text-amber-200">UI 체험용 결과 · 승인 대상 아님</div><div className="flex aspect-video items-center justify-center"><video className="h-full w-full object-contain" src="/mock-assets/sample-video-web.mp4" poster="/mock-assets/video-poster.webp" controls muted playsInline preload="metadata"/></div></article></section> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="h-full overflow-y-auto bg-[#0c0b10] p-6 lg:p-10">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-fuchsia-300">5 · 편집·출력</p>
        <h1 className="mt-2 text-3xl font-black text-white">생성본을 타임라인에서 완성합니다</h1>
        <div className="mt-8"><EmptyState title="편집할 프로젝트 미디어가 없습니다" description="생성 완료된 take 또는 업로드한 미디어를 타임라인에 추가하세요. 샘플 미디어는 정식 클립으로 가장하지 않습니다." action={<button type="button" onClick={onOpenEdit} className="rounded-xl bg-white px-5 py-2.5 text-sm font-black text-black hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">편집기 열기</button>}/></div>
      </div>
    </section>
  );
}
