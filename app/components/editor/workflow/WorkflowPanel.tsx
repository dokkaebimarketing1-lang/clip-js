"use client";

import {useEffect, useMemo, useRef, useState} from 'react';
import toast from 'react-hot-toast';
import {commitProjectMutation, getFile, getProject, useAppDispatch, useAppSelector} from '@/app/store';
import {rehydrate, setIncludeSubtitles, setMediaFiles, setWorkflow} from '@/app/store/slices/projectSlice';

import {creativeApprovalSchema, generationApprovalSchema, postProductionSchema, productionManifestSchema, releaseApprovalSchema, storyboardSchema, interviewBriefSchema, characterSheetSchema, type CaptionKind, type CaptionPosition, type CaptionPreset, type EffectSpec, type GenerationTake, type HiggsfieldAsset, type TransitionSpec} from '@/app/lib/workflow/schema';
import {assertRenderReleaseApproved} from '@/app/lib/workflow/approval-v3';
import {EFFECT_CATALOG} from '@/app/lib/workflow/effect-catalog';
import {TRANSITION_CATALOG, transitionProviderFor} from '@/app/lib/workflow/transition-catalog';
import {assertSafeRemoteUrl} from '@/app/lib/security/remote-url';
import {downloadProjectDocument, importProjectIntoCurrentProject, parseProjectDocument} from '@/app/lib/workflow/project-file';
import {parseSrt} from '@/app/lib/captions/srt';
import {buildWordTimings, CAPTION_CATALOG, CAPTION_FONT_FAMILY} from '@/app/lib/captions/caption-registry';
import {normalizeRenderDownloadUrl} from '@/app/lib/render/download-url';
import type {MediaFile} from '@/app/types';
import {buildTakeClipMedia, compileShotPrompt, createGenerationTake} from '@/app/lib/workflow/production';
import {deriveProductionFromStoryboard} from '@/app/lib/workflow/storyboard-converter';
import {prepareApprovedTakeImport, ReadyGenerationCandidate, upsertQcPendingTake} from '@/app/lib/workflow/generated-take';
import {takeApprovalSchema} from '@/app/lib/workflow/production-schema';
import SeedanceMasterPanel from './SeedanceMasterPanel';
import {seedanceMasterSettingsSchema} from '@/app/lib/workflow/seedance-master';

const fieldClass = 'w-full rounded border border-white/15 bg-black/30 px-2 py-1 text-sm text-white';
const buttonClass = 'rounded bg-white px-3 py-2 text-sm font-semibold text-black hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40';

const sha256Blob = async (blob: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const flushProjectPersistence = (): Promise<number> => new Promise((resolve, reject) => {
  window.dispatchEvent(new CustomEvent('clipjs:flush-project', {detail: {resolve, reject}}));
});

type AuthorizationPreviewUi = {
  attemptId: string; requestHash: string; requestKey: string; model: string; task: string;
  duration: number; ratio: string; resolution: string; generateAudio: boolean; referenceCount: number; promptPreview: string;
};

type GenerationProjectionUi = {
  requestKey: string;
  projectId: string;
  job: {
    status: string;
    model: string;
    providerJobId?: string;
    authorizedDuration: 20 | 30;
    actualDurationSeconds?: number;
    authorizedResolution: '480p' | '720p';
    takeScope: 'production' | 'shot';
    targetShotSpecId?: string;
    updatedAt: string;
    takeId?: string;
    assetId?: string;
    contentSha256?: string;
    qcStatus?: string;
    lastError?: string;
  };
};

export default function WorkflowPanel() {
  const project = useAppSelector((state) => state.projectState);
  const dispatch = useAppDispatch();
  const [storyboardJson, setStoryboardJson] = useState('');
  const [productionJson, setProductionJson] = useState('');
  const [postProductionJson, setPostProductionJson] = useState('');
  const [selectedShotSpecId, setSelectedShotSpecId] = useState('');
  const [url, setUrl] = useState('');
  const [model, setModel] = useState('seedance_2_5');
  const [cutId, setCutId] = useState('CUT01');
  const [shotId, setShotId] = useState('S1');
  const [duration, setDuration] = useState(5);
  const [role, setRole] = useState<HiggsfieldAsset['role']>('clip');
  const [takeShotSpecId, setTakeShotSpecId] = useState('');
  const [takeProvider, setTakeProvider] = useState('byteplus');
  const [takeModel, setTakeModel] = useState('dreamina-seedance-2-5-260628');
  const [takeMode, setTakeMode] = useState('omni_reference');
  const [takeResolution, setTakeResolution] = useState('720p');
  const [takeExtensionMode, setTakeExtensionMode] = useState('');
  const [takeVerdict, setTakeVerdict] = useState<GenerationTake['verdict']>('accepted');
  const [takeParentId, setTakeParentId] = useState('');
  const [takeOutputAssetId, setTakeOutputAssetId] = useState('');
  const [takeUrl, setTakeUrl] = useState('');
  const [srt, setSrt] = useState('');
  const [captionText, setCaptionText] = useState('');
  const [captionKind, setCaptionKind] = useState<CaptionKind>('dialogue');
  const [captionPreset, setCaptionPreset] = useState<CaptionPreset>('dialogue-clean');
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>('bottom');
  const [captionStart, setCaptionStart] = useState(0);
  const [captionEnd, setCaptionEnd] = useState(2);
  const [captionIntensity, setCaptionIntensity] = useState(0.6);
  const [captionAccent, setCaptionAccent] = useState('#ffd43b');
  const vlogSentenceRef = useRef<HTMLTextAreaElement>(null);
  const [vlogResult, setVlogResult] = useState<{
    interviewBrief?: Record<string, unknown>;
    characterSheet?: Record<string, unknown>;
    storyboard?: Record<string, unknown>;
    seedanceMaster?: Record<string, unknown>;
    imageStoryboard?: Array<{cutId: string; shotId: string; placeholder: string}>;
  } | null>(null);
  const [transitionType, setTransitionType] = useState<TransitionSpec['type']>('fade');
  const [fromMediaId, setFromMediaId] = useState('');
  const [toMediaId, setToMediaId] = useState('');
  const [transitionDuration, setTransitionDuration] = useState(0.35);
  const [effectType, setEffectType] = useState<EffectSpec['type']>('chromatic-aberration');
  const [effectMediaId, setEffectMediaId] = useState('');
  const [effectIntensity, setEffectIntensity] = useState(0.4);
  const [apiToken, setApiToken] = useState('');
  const [approvalToken, setApprovalToken] = useState('');
  const [attemptId, setAttemptId] = useState(() => crypto.randomUUID());
  const [authorizationPreview, setAuthorizationPreview] = useState<AuthorizationPreviewUi | null>(null);
  const [generationRecords, setGenerationRecords] = useState<GenerationProjectionUi[]>([]);
  const [previewRefreshNonce, setPreviewRefreshNonce] = useState(0);
  const mediaFilesRef = useRef(project.mediaFiles);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('clipjs:generation-status', {
      detail: {hasSubmittedGeneration: generationRecords.length > 0},
    }));
  }, [generationRecords.length]);
  useEffect(() => { mediaFilesRef.current = project.mediaFiles; }, [project.mediaFiles]);
  const generatedAssetKey = useMemo(() => project.mediaFiles
    .filter((media) => media.source?.kind === 'generated' || media.source?.kind === 'managed')
    .map((media) => `${media.id}:${media.source?.kind === 'generated' ? media.source.generatedAssetId : media.source?.kind === 'managed' ? media.source.assetId : ''}`)
    .sort()
    .join('|'), [project.mediaFiles]);

  useEffect(() => {
    if (!apiToken || !generatedAssetKey) return;
    let cancelled = false;
    const refresh = async () => {
      const replacements = new Map<string, string>();
      const currentMedia = mediaFilesRef.current;
      await Promise.all(currentMedia.filter((media) => media.source?.kind === 'generated' || media.source?.kind === 'managed').map(async (media) => {
        const assetId = media.source?.kind === 'generated' ? media.source.generatedAssetId : media.source?.kind === 'managed' ? media.source.assetId : undefined;
        if (!assetId) return;
        const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/assets/${encodeURIComponent(assetId)}/capability`, {
          method: 'POST',
          headers: {authorization: ['Bear', 'er ', apiToken].join('')},
        });
        if (!response.ok) return;
        const result = await response.json() as {url?: string};
        if (result.url) replacements.set(media.id, result.url);
      }));
      if (!cancelled && replacements.size) {
        dispatch(setMediaFiles(currentMedia.map((media) => replacements.has(media.id) ? {...media, src: replacements.get(media.id)} : media)));
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 8 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [apiToken, dispatch, generatedAssetKey, previewRefreshNonce, project.id]);
  const [rendering, setRendering] = useState(false);
  const [renderRetryRequired, setRenderRetryRequired] = useState(false);
  const [renderDownloadUrl, setRenderDownloadUrl] = useState('');
  const approvalLabel = useMemo(
    () => `CREATIVE ${project.workflow.creativeApproval.status.toUpperCase()} · GENERATION ${project.workflow.generationApproval.status.toUpperCase()} · RELEASE ${project.workflow.releaseApproval.status.toUpperCase()}`,
    [project.workflow.creativeApproval.status, project.workflow.generationApproval.status, project.workflow.releaseApproval.status],
  );
  const compiledPrompt = useMemo(() => {
    if (!selectedShotSpecId) return '';
    try {
      return compileShotPrompt(project.workflow.production, selectedShotSpecId);
    } catch (error) {
      return error instanceof Error ? `Not generation-ready: ${error.message}` : 'Not generation-ready.';
    }
  }, [project.workflow.production, selectedShotSpecId]);

  const importStoryboard = () => {
    try {
      const storyboard = storyboardSchema.parse(JSON.parse(storyboardJson));
      dispatch(setWorkflow({...project.workflow, storyboard}));
      toast.success('스토리보드를 가져왔습니다. 기존 승인은 무효화되었습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '스토리보드 JSON 형식이 올바르지 않습니다.');
    }
  };

  const runVlogCompose = async () => {
    const sentence = vlogSentenceRef.current?.value?.trim() ?? '';
    if (!sentence) {
      toast.error('한 문장을 입력하세요.');
      return;
    }
    try {
      const res = await fetch('/api/vlog/compose', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({sentence}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error((data as {error?: string}).error ?? '영상 구성에 실패했습니다.');
        return;
      }
      setVlogResult(data as typeof vlogResult);
      const storyboard = storyboardSchema.parse(data.storyboard);
      const characterSheet = characterSheetSchema.parse(data.characterSheet);
      const seedanceMaster = seedanceMasterSettingsSchema.parse(data.seedanceMaster);
      dispatch(setWorkflow({
        ...project.workflow,
        interviewBrief: interviewBriefSchema.parse(data.interviewBrief),
        characterSheet,
        storyboard,
        seedanceMaster,
      }));
      toast.success('제작 구성을 완료했습니다. 인터뷰·캐릭터·스토리보드·28축 설정을 검토한 뒤 승인하세요.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '영상 구성에 실패했습니다.');
    }
  };

  const importProductionManifest = () => {
    try {
      const production = productionManifestSchema.parse(JSON.parse(productionJson));
      dispatch(setWorkflow({...project.workflow, production}));
      setSelectedShotSpecId(production.shotSpecs[0]?.id ?? '');
      toast.success('제작 명세를 적용했습니다. 기존 승인은 무효화되었습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '제작 명세 JSON 형식이 올바르지 않습니다.');
    }
  };

  const importPostProduction = () => {
    try {
      const postProduction = postProductionSchema.parse(JSON.parse(postProductionJson));
      dispatch(setWorkflow({...project.workflow, postProduction}));
      toast.success('후반 작업 설정을 적용했습니다. 최종 승인은 무효화되었습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '후반 작업 JSON 형식이 올바르지 않습니다.');
    }
  };

  const stagePostProductionMedia = async () => {
    if (!apiToken || !approvalToken) return toast.error('에이전트 토큰과 소유자 승인 토큰이 필요합니다.');
    const post = project.workflow.postProduction;
    const referenced = new Set([
      ...post.dialogueCues.map((cue) => cue.mediaId),
      ...post.ambience.map((lane) => lane.mediaId),
      ...post.sfx.map((lane) => lane.mediaId),
      ...post.bgm.map((lane) => lane.mediaId),
      ...post.appUiOverlays.map((overlay) => overlay.mediaId),
    ]);
    const candidates = project.mediaFiles.filter((media) => referenced.has(media.id) && media.source?.kind === 'indexeddb');
    if (!candidates.length) return toast.success('서버 자산으로 전환할 로컬 후반 작업 미디어가 없습니다.');
    try {
      const replacements = new Map<string, {assetId: string; contentSha256: string}>();
      for (const media of candidates) {
        if (!['video', 'audio', 'image'].includes(media.type)) throw new Error(`미디어 ${media.id}의 형식을 지원하지 않습니다.`);
        const fileId = media.source?.kind === 'indexeddb' ? media.source.fileId : media.fileId;
        if (!fileId) throw new Error(`미디어 ${media.id}에 연결된 IndexedDB 파일이 없습니다.`);
        const file = await getFile(fileId);
        if (!file) throw new Error(`미디어 ${media.id} 파일을 찾을 수 없습니다.`);
        const contentSha256 = await sha256Blob(file);
        const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/assets/upload`, {
          method: 'POST',
          headers: {
            authorization: ['Bear', 'er ', apiToken].join(''),
            'x-clipjs-approval-token': approvalToken,
            'x-clipjs-media-kind': media.type,
            'x-clipjs-media-id': media.id,
            'x-clipjs-content-sha256': contentSha256,
            'x-clipjs-byte-length': String(file.size),
            'content-type': file.type || 'application/octet-stream',
          },
          body: file,
        });
        const result = await response.json() as {asset?: {id?: string; projectId?: string; contentSha256?: string}; error?: string};
        if (!response.ok || !result.asset?.id || result.asset.projectId !== project.id || result.asset.contentSha256 !== contentSha256) {
          throw new Error(result.error || `미디어 ${media.id} 업로드에 실패했습니다.`);
        }
        replacements.set(media.id, {assetId: result.asset.id, contentSha256});
      }
      dispatch(setMediaFiles(project.mediaFiles.map((media) => {
        const replacement = replacements.get(media.id);
        if (!replacement) return media;
        const managed = {...media, source: {kind: 'managed' as const, assetId: replacement.assetId}, contentSha256: replacement.contentSha256, provider: 'local' as const};
        delete managed.fileId;
        delete managed.src;
        delete managed.remoteUrl;
        return managed;
      })));
      toast.success(`후반 작업 미디어 ${replacements.size}개를 서버 자산으로 전환했습니다.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '후반 작업 미디어를 서버 자산으로 전환하지 못했습니다.');
    }
  };

  const generateFromStoryboard = () => {
    if (!project.workflow.storyboard) { toast.error('먼저 스토리보드를 가져오세요.'); return; }
    const derived = deriveProductionFromStoryboard(project.workflow.storyboard, project.workflow.production);
    setProductionJson(JSON.stringify(derived, null, 2));
    toast.success(`샷 명세 ${derived.shotSpecs.length}개와 연속성 잠금 ${derived.continuityLocks.length}개를 만들었습니다. 검토한 뒤 적용하세요.`);
  };

  const approve = async () => {
    if (!project.workflow.storyboard) return toast.error('먼저 스토리보드를 가져오세요.');
    try {
      const response = await fetch('/api/approval/storyboard', {
        method: 'POST',
        headers: {'content-type': 'application/json', ...(approvalToken ? {'x-clipjs-approval-token': approvalToken} : {})},
        body: JSON.stringify({projectId: project.id, storyboard: project.workflow.storyboard}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '승인에 실패했습니다.');
      const creativeApproval = creativeApprovalSchema.parse(result.creativeApproval);
      dispatch(setWorkflow({...project.workflow, creativeApproval}));
      setAuthorizationPreview(null);
      setApprovalToken('');
      toast.success('현재 스토리보드를 제작 승인하고 서버 서명을 완료했습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '승인에 실패했습니다.');
    }
  };

  const previewGenerationAuthorization = async () => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/generation-authorization/preview`, {
        method: 'POST',
        headers: {'content-type': 'application/json', ...(approvalToken ? {'x-clipjs-approval-token': approvalToken} : {})},
        body: JSON.stringify({attemptId, project}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '생성 승인 미리보기에 실패했습니다.');
      setAuthorizationPreview(result as AuthorizationPreviewUi);
      toast.success('BytePlus 표준 요청 미리보기를 준비했습니다. 공급자 API는 호출하지 않았습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '생성 승인 미리보기에 실패했습니다.');
    }
  };

  const authorizeGeneration = async () => {
    if (!authorizationPreview || authorizationPreview.attemptId !== attemptId) return toast.error('먼저 현재 생성 시도를 미리보기로 확인하세요.');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/generation-authorization/sign`, {
        method: 'POST',
        headers: {'content-type': 'application/json', ...(approvalToken ? {'x-clipjs-approval-token': approvalToken} : {})},
        body: JSON.stringify({attemptId, expectedRequestHash: authorizationPreview.requestHash, project}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '생성 승인에 실패했습니다.');
      const generationApproval = generationApprovalSchema.parse(result.generationApproval);
      dispatch(setWorkflow({...project.workflow, generationApproval}));
      setApprovalToken('');
      toast.success('현재 생성 시도와 BytePlus 요청을 승인했습니다. 공급자 API는 호출하지 않았습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '생성 승인에 실패했습니다.');
    }
  };

  const startNewAttempt = () => {
    setAttemptId(crypto.randomUUID());
    setAuthorizationPreview(null);
  };

  const refreshGenerations = async () => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/generations`, {
        headers: apiToken ? {authorization: ['Bear', 'er ', apiToken].join('')} : {},
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '생성 상태를 새로고침하지 못했습니다.');
      setGenerationRecords(Array.isArray(result.generations) ? result.generations as GenerationProjectionUi[] : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '생성 상태를 새로고침하지 못했습니다.');
    }
  };

  const submitAuthorizedAttempt = async () => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/generations`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiToken ? {authorization: ['Bear', 'er ', apiToken].join('')} : {}),
          ...(approvalToken ? {'x-clipjs-approval-token': approvalToken} : {}),
        },
        body: JSON.stringify({project}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '생성 요청 제출에 실패했습니다.');
      setGenerationRecords((records) => [result.generation as GenerationProjectionUi, ...records.filter((item) => item.requestKey !== result.generation.requestKey)]);
      toast.success(result.reused ? '기존 생성 접수 내역을 재사용했습니다. 공급자에 다시 제출하지 않았습니다.' : '생성 요청을 한 번 제출했습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '생성 요청 제출에 실패했습니다.');
    }
  };

  const registerReadyCandidate = (generation: GenerationProjectionUi) => {
    const job = generation.job;
    if (job.status !== 'ready' || !job.takeId || !job.assetId || !job.contentSha256 || !job.providerJobId) return toast.error('아직 품질 검수를 시작할 수 있는 생성 결과가 없습니다.');
    const authorization = project.workflow.generationApproval;
    const candidate: ReadyGenerationCandidate = {
      requestKey: generation.requestKey,
      claim: {projectId: generation.projectId, attemptId: authorization.attemptId ?? '', requestHash: authorization.requestHash ?? ''},
      job: {
        status: 'ready', takeId: job.takeId, assetId: job.assetId, contentSha256: job.contentSha256,
        authorizedResolution: job.authorizedResolution, providerJobId: job.providerJobId, model: job.model, updatedAt: job.updatedAt,
        takeScope: job.takeScope, targetShotSpecId: job.targetShotSpecId,
        provider: authorization.provider ?? 'byteplus', authorizationRef: authorization.signature ?? '',
      },
    };
    const next = upsertQcPendingTake(project, candidate);
    dispatch(rehydrate(next));
    toast.success('후보를 품질 검수 대기 상태로 등록했습니다. 타임라인에는 추가하지 않았습니다.');
  };

  const approveAndImportReadyTake = async (generation: GenerationProjectionUi) => {
    const job = generation.job;
    if (job.status !== 'ready' || !job.takeId || !job.assetId || !job.contentSha256) return toast.error('아직 테이크를 승인할 수 있는 생성 결과가 없습니다.');
    try {
      await flushProjectPersistence();
      const approveResponse = await fetch(`/api/projects/${encodeURIComponent(project.id)}/takes/${encodeURIComponent(job.takeId)}/approve`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiToken ? {authorization: ['Bear', 'er ', apiToken].join('')} : {}),
          ...(approvalToken ? {'x-clipjs-approval-token': approvalToken} : {}),
        },
        body: JSON.stringify({requestKey: generation.requestKey, assetId: job.assetId, contentSha256: job.contentSha256}),
      });
      const approveResult = await approveResponse.json();
      if (!approveResponse.ok) throw new Error(approveResult.error || '테이크 승인에 실패했습니다.');
      const takeApproval = takeApprovalSchema.parse(approveResult.takeApproval);
      const persisted = await getProject(project.id);
      if (!persisted?.workflow.production.takes.some((take) => take.id === job.takeId)) throw new Error('승인 전에 품질 검수 대기 후보를 저장하세요.');
      if (!job.actualDurationSeconds) throw new Error('생성 결과에 검증된 길이 정보가 없습니다.');
      const committed = await commitProjectMutation(project.id, persisted.revision, (current) => prepareApprovedTakeImport(current, job.takeId!, takeApproval, job.actualDurationSeconds!));
      let previewUrl: string | undefined;
      const capabilityResponse = await fetch(`/api/projects/${encodeURIComponent(project.id)}/assets/${encodeURIComponent(job.assetId)}/capability`, {
        method: 'POST', headers: apiToken ? {authorization: ['Bear', 'er ', apiToken].join('')} : {},
      });
      if (capabilityResponse.ok) previewUrl = (await capabilityResponse.json()).url;
      const runtime = previewUrl ? {...committed, mediaFiles: committed.mediaFiles.map((media) => media.takeId === job.takeId ? {...media, src: previewUrl} : media)} : committed;
      dispatch(rehydrate(runtime));
      toast.success('테이크 승인을 저장하고 타임라인에 한 번 배치했습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '테이크를 가져오지 못했습니다.');
    }
  };

  const importHiggsfield = () => {
    try {
      const safeUrl = assertSafeRemoteUrl(url).toString();
      const cut = project.workflow.storyboard?.cuts.find((item) => item.id === cutId);
      const shot = cut?.shots.find((item) => item.id === shotId);
      if (!cut || !shot) {
        throw new Error('가져온 스토리보드에 해당 컷과 샷이 있어야 합니다.');
      }
      const id = crypto.randomUUID();
      const positionStart = role === 'clip'
        ? project.mediaFiles.reduce((max, item) => Math.max(max, item.positionEnd), 0)
        : cut.absoluteStartSeconds + shot.startSeconds;
      const type = role === 'audio' ? 'audio' : role === 'start' || role === 'end' || role === 'storyboard-sheet' ? 'image' : 'video';
      const extension = type === 'audio' ? 'mp3' : type === 'image' ? 'png' : 'mp4';
      const asset: HiggsfieldAsset = {id, provider: 'higgsfield', model, url: safeUrl, cutId, shotId, role, durationSeconds: duration};
      const media: MediaFile = {
        id,
        fileName: `${cutId}-${shotId}-${role}-${model}.${extension}`,
        fileId: id,
        type,
        startTime: 0,
        endTime: duration,
        positionStart,
        positionEnd: positionStart + duration,
        includeInMerge: true,
        playbackSpeed: 1,
        volume: 100,
        zIndex: 1,
        opacity: 100,
        src: safeUrl,
        remoteUrl: safeUrl,
        provider: 'higgsfield',
        model,
        cutId,
        shotId,
        storyboardRole: role,
      };
      dispatch(setMediaFiles([...project.mediaFiles, media]));
      dispatch(setWorkflow({...project.workflow, higgsfieldAssets: [...project.workflow.higgsfieldAssets, asset]}));
      setUrl('');
      toast.success(`${cutId}/${shotId} Higgsfield ${role}을 ${positionStart.toFixed(2)}초 위치에 가져왔습니다.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Higgsfield 미디어를 가져오지 못했습니다.');
    }
  };

  const importProject = async (file: File) => {
    try {
      const parsed = importProjectIntoCurrentProject(parseProjectDocument(JSON.parse(await file.text())), project.id);
      const mediaFiles = await Promise.all(parsed.mediaFiles.map(async (media) => {
        if (media.source?.kind === 'generated' || media.source?.kind === 'managed') return media;
        if (media.remoteUrl) return {...media, src: media.remoteUrl};
        const fileId = media.source?.kind === 'indexeddb' ? media.source.fileId : media.fileId;
        if (!fileId) throw new Error(`미디어 ${media.id}가 IndexedDB에 저장되어 있지 않습니다.`);
        const stored = await getFile(fileId);
        return stored ? {...media, src: URL.createObjectURL(stored)} : media;
      }));
      dispatch(rehydrate({...parsed, mediaFiles}));
      toast.success('프로젝트 JSON을 가져왔습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '프로젝트 파일 형식이 올바르지 않습니다.');
    }
  };

  const importSrt = () => {
    try {
      dispatch(setWorkflow({...project.workflow, captions: parseSrt(srt)}));
      dispatch(setIncludeSubtitles(true));
      toast.success('한국어 자막을 가져왔습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'SRT 형식이 올바르지 않습니다.');
    }
  };

  const addCaption = () => {
    if (!captionText.trim()) return toast.error('자막 문구를 입력하세요.');
    if (captionEnd <= captionStart) return toast.error('자막 종료 시간은 시작 시간보다 늦어야 합니다.');
    const startMs = Math.round(captionStart * 1000);
    const endMs = Math.round(captionEnd * 1000);
    dispatch(setWorkflow({...project.workflow, captions: [...project.workflow.captions, {
      id: crypto.randomUUID(), text: captionText.trim(), startSeconds: captionStart, endSeconds: captionEnd,
      kind: captionKind, preset: captionPreset, position: captionPosition, intensity: captionIntensity,
      accentColor: captionAccent, fontFamily: CAPTION_FONT_FAMILY,
      wordTimings: buildWordTimings(captionText.trim(), startMs, endMs), emphasis: [], safeArea: true,
    }]}));
    dispatch(setIncludeSubtitles(true));
    setCaptionText('');
    toast.success(`${captionKind} 자막을 추가했습니다.`);
  };

  const addTransition = () => {
    if (!fromMediaId || !toMediaId || fromMediaId === toMediaId) return toast.error('서로 다른 미디어 클립 두 개를 선택하세요.');
    const transition: TransitionSpec = {
      id: crypto.randomUUID(),
      type: transitionType,
      provider: transitionProviderFor(transitionType),
      fromMediaId,
      toMediaId,
      durationSeconds: transitionDuration,
    };
    dispatch(setWorkflow({...project.workflow, transitions: [...project.workflow.transitions, transition]}));
    toast.success(`${transitionType} 전환 효과를 추가했습니다.`);
  };

  const addEffect = () => {
    const media = project.mediaFiles.find((item) => item.id === effectMediaId);
    if (!media || !['video', 'image'].includes(media.type)) return toast.error('영상 또는 이미지 클립을 선택하세요.');
    const effect: EffectSpec = {
      id: crypto.randomUUID(),
      targetMediaId: media.id,
      type: effectType,
      provider: 'remotion',
      intensity: effectIntensity,
      startSeconds: media.positionStart,
      endSeconds: media.positionEnd,
    };
    dispatch(setWorkflow({...project.workflow, effects: [...project.workflow.effects, effect]}));
    toast.success(`${media.fileName}에 ${effectType} 효과를 추가했습니다.`);
  };

  const removeEffect = (effectId: string) => {
    dispatch(setWorkflow({...project.workflow, effects: project.workflow.effects.filter((effect) => effect.id !== effectId)}));
  };

  const recordTake = async () => {
    if (!takeShotSpecId) { toast.error('먼저 생성 준비가 완료된 샷을 선택하세요.'); return; }
    try {
      const shot = project.workflow.production.shotSpecs.find((item) => item.id === takeShotSpecId);
      const outputAssetId = takeOutputAssetId || crypto.randomUUID();
      const take = await createGenerationTake(project.workflow.production, {
        shotSpecId: takeShotSpecId,
        parentTakeId: takeParentId || undefined,
        provider: takeProvider,
        model: takeModel,
        mode: takeMode as GenerationTake['mode'],
        resolution: takeResolution as GenerationTake['resolution'],
        extensionMode: (takeExtensionMode || undefined) as GenerationTake['extensionMode'],
        outputAssetId,
        verdict: takeVerdict,
      });
      const takes = [...project.workflow.production.takes, take];
      const higgsfieldAssets = takeUrl && shot
        ? [...project.workflow.higgsfieldAssets.filter((asset) => asset.id !== outputAssetId), {
            id: outputAssetId, provider: 'higgsfield', model: takeModel, url: assertSafeRemoteUrl(takeUrl).toString(),
            cutId: shot.cutId, shotId: shot.shotId, role: 'clip', durationSeconds: shot.durationSeconds,
          } satisfies HiggsfieldAsset]
        : project.workflow.higgsfieldAssets;
      dispatch(setWorkflow({...project.workflow, production: {...project.workflow.production, takes}, higgsfieldAssets}));
      setTakeParentId(''); setTakeOutputAssetId(''); setTakeUrl('');
      toast.success(`${takeShotSpecId}에 ${takeVerdict} 테이크를 기록했습니다.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '테이크를 기록하지 못했습니다.');
    }
  };

  const selectTake = (takeId: string) => {
    const take = project.workflow.production.takes.find((item) => item.id === takeId);
    if (!take || take.verdict !== 'accepted') return;
    const takes = project.workflow.production.takes.map((item) => item.id === takeId
      ? {...item, selected: true}
      : item.shotSpecId === take.shotSpecId ? {...item, selected: false} : item);
    dispatch(setWorkflow({...project.workflow, production: {...project.workflow.production, takes}}));
    toast.success(`테이크 ${take.id.slice(0, 8)}…을 대표 버전으로 지정했습니다. 렌더링 전에 다시 승인하세요.`);
  };

  const retakeTake = (takeId: string) => {
    const take = project.workflow.production.takes.find((item) => item.id === takeId);
    if (!take) return;
    setTakeShotSpecId(take.shotSpecId ?? '');
    setTakeParentId(take.id);
    toast.success(`${take.scope === 'production' ? '전체 제작 범위' : take.shotSpecId}의 재생성 양식을 채웠습니다. 상위 테이크: ${take.id.slice(0, 8)}…`);
  };

  const addTakeToTimeline = (takeId: string) => {
    const take = project.workflow.production.takes.find((item) => item.id === takeId);
    if (!take) return;
    const shot = project.workflow.production.shotSpecs.find((item) => item.id === take.shotSpecId);
    const cut = project.workflow.storyboard?.cuts.find((item) => item.id === shot?.cutId);
    const storyboardShot = cut?.shots.find((item) => item.id === shot?.shotId);
    const asset = project.workflow.higgsfieldAssets.find((item) => item.id === take.outputAssetId);
    const result = buildTakeClipMedia({take, shot, cut, storyboardShot, asset, mediaFiles: project.mediaFiles});
    if (result.alreadyOnTimeline) {
      const media = project.mediaFiles.find((item) => item.id === take.outputAssetId);
      toast.success(`테이크 클립이 이미 타임라인 ${media?.positionStart.toFixed(2)}초 위치에 있습니다.`);
      return;
    }
    if (!result.media) { toast.error('테이크에 클립 URL이 없습니다. 먼저 Higgsfield 가져오기를 사용하세요.'); return; }
    dispatch(setMediaFiles([...project.mediaFiles, result.media]));
    toast.success(`테이크 클립을 타임라인 ${result.media.positionStart.toFixed(2)}초 위치에 배치했습니다.`);
  };

  const approveRelease = async () => {
    try {
      const response = await fetch('/api/approval/release', {
        method: 'POST',
        headers: {'content-type': 'application/json', ...(approvalToken ? {'x-clipjs-approval-token': approvalToken} : {})},
        body: JSON.stringify({project}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '최종 승인에 실패했습니다.');
      const releaseApproval = releaseApprovalSchema.parse(result);
      dispatch(setWorkflow({...project.workflow, releaseApproval}));
      setApprovalToken('');
      toast.success('현재 타임라인·미디어·자막·오디오·효과·내보내기 설정을 최종 승인했습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '최종 승인에 실패했습니다.');
    }
  };

  const renderProject = async () => {
    setRendering(true);
    setRenderDownloadUrl('');
    try {
      await assertRenderReleaseApproved(project);
      const authorization = apiToken ? ['Bear', 'er ', apiToken].join('') : '';
      const response = await fetch('/api/render', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? {authorization} : {}),
          ...(approvalToken ? {'x-clipjs-approval-token': approvalToken} : {}),
          ...(renderRetryRequired ? {'x-clipjs-render-retry': 'true'} : {}),
        },
        body: JSON.stringify({project}),
      });
      const receipt = await response.json();
      if (!response.ok) {
        if (receipt.code === 'RENDER_RETRY_REQUIRED') setRenderRetryRequired(true);
        throw new Error(receipt.error || '렌더 작업을 대기열에 등록하지 못했습니다.');
      }
      setRenderRetryRequired(false);
      if (typeof receipt.statusUrl !== 'string') throw new Error('렌더 접수 내역에 상태 URL이 없습니다.');
      toast.success(receipt.reused ? '기존 렌더 작업을 재개했습니다.' : '렌더 작업을 대기열에 등록했습니다.');
      for (let attempt = 0; attempt < 360; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const statusResponse = await fetch(receipt.statusUrl, {headers: authorization ? {authorization} : {}});
        const statusResult = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(statusResult.error || '렌더 상태를 확인하지 못했습니다.');
        if (statusResult.status === 'succeeded') {
          setRenderDownloadUrl(normalizeRenderDownloadUrl(statusResult.downloadUrl, window.location.origin));
          setApiToken('');
          setApprovalToken('');
          toast.success('Remotion 렌더링을 완료했습니다. 아래 링크에서 내려받으세요.');
          return;
        }
        if (statusResult.status === 'failed' || statusResult.status === 'cancelled' || statusResult.status === 'expired') {
          setRenderRetryRequired(true);
          throw new Error(statusResult.error || `렌더 상태: ${statusResult.status}. 직접 다시 시도해야 합니다.`);
        }
      }
      throw new Error('렌더링이 아직 진행 중입니다. 잠시 후 상태를 새로고침하세요. 서버 작업은 취소되지 않았습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '렌더링에 실패했습니다.');
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="space-y-6 text-sm">
      <section id="generation-compose" className="scroll-mt-3 space-y-2 rounded border border-white/10 p-3">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-fuchsia-500/20 text-xs font-bold text-fuchsia-300">V</span>
            <h3 className="font-semibold text-white">VLOG 파이프라인</h3>
            <span className="ml-auto text-xs text-gray-400">AI 감독 8단계 자동화</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {[
              ['①', '문장'],
              ['②', '인터뷰'],
              ['③', '이미지 콘티'],
              ['④', '캐릭터'],
              ['⑤', '캐릭터 승인'],
              ['⑥', '스토리보드'],
              ['⑦', '28축'],
              ['⑧', '프롬프트 확인'],
            ].map(([num, label]) => (
              <span key={num} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-gray-300">
                <span className="font-bold text-fuchsia-300">{num}</span>{label}
              </span>
            ))}
          </div>
          <div className="rounded-xl border border-white/10 bg-gradient-to-br from-fuchsia-500/10 to-transparent p-3">
            <label className="mb-1 block text-xs font-medium text-gray-300">한 문장으로 영상 컨셉을 말해주세요</label>
            <textarea ref={vlogSentenceRef} className={`${fieldClass} min-h-20`} defaultValue="" placeholder="예: 고양이와 인사하는 30초 VLOG 만들어줘" />
            <button className="mt-2 w-full rounded-lg bg-fuchsia-600 px-4 py-2 font-semibold text-white transition hover:bg-fuchsia-500" onClick={() => void runVlogCompose()}>⚡ 한 문장으로 8단계 컴포즈</button>
          </div>
          {vlogResult ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ['인터뷰 브리프', vlogResult.interviewBrief],
                ['캐릭터 시트', vlogResult.characterSheet],
                ['스토리보드', vlogResult.storyboard ?? vlogResult.imageStoryboard],
                ['28축 프롬프트', vlogResult.seedanceMaster?.axes],
              ].map((pair) => {
                const label = pair[0] as string;
                const value = pair[1];
                return (
                  <div key={label} className="rounded-lg border border-white/10 bg-black/40 p-2">
                    <div className="mb-1 text-[11px] font-semibold text-fuchsia-300">{label}</div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-snug text-gray-300">{JSON.stringify(value ?? null, null, 2)}</pre>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </section>
      <section id="generation-creative" className="scroll-mt-3 space-y-2 rounded border border-white/10 p-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">승인 단계</h3><span className="rounded bg-white/10 px-2 py-1 text-xs">{approvalLabel}</span></div>
        <textarea className={`${fieldClass} min-h-32`} value={storyboardJson} onChange={(event) => setStoryboardJson(event.target.value)} placeholder="storyboard-v2 JSON 붙여넣기" />
        <div id="generation-authorization" className="scroll-mt-3 flex flex-wrap gap-2">
          <button className={buttonClass} onClick={importStoryboard}>스토리보드 가져오기</button>
          <button className={buttonClass} onClick={approve} disabled={!project.workflow.storyboard}>제작 승인</button>
          <button className={buttonClass} onClick={startNewAttempt}>새 유료 생성 시도</button>
          <button className={buttonClass} onClick={previewGenerationAuthorization} disabled={project.workflow.creativeApproval.status !== 'approved'}>BytePlus 요청 미리보기</button>
          <button className={buttonClass} onClick={authorizeGeneration} disabled={!authorizationPreview}>현재 생성 시도 승인</button>
        </div>
        <div className="rounded bg-black/30 p-2 text-xs text-gray-300">생성 시도 <code>{attemptId}</code></div>
        {authorizationPreview && (
          <details className="rounded border border-white/10 bg-black/20 p-2 text-xs">
            <summary className="cursor-pointer font-semibold">{authorizationPreview.model} · {authorizationPreview.task} · {authorizationPreview.duration}s · {authorizationPreview.ratio} · {authorizationPreview.resolution} · refs {authorizationPreview.referenceCount}</summary>
            <p className="mt-2 break-all text-gray-400">requestKey {authorizationPreview.requestKey}</p>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-gray-300">{authorizationPreview.promptPreview}</pre>
          </details>
        )}
        <input className={fieldClass} type="password" autoComplete="off" value={approvalToken} onChange={(event) => setApprovalToken(event.target.value)} placeholder="소유자 승인 토큰(운영 환경)" />
        <p className="text-xs text-gray-400">제작 승인, 유료 생성 승인, 테이크 승인, 최종 승인은 서로 별개입니다. 미리보기와 서명 과정에서는 BytePlus를 호출하지 않습니다.</p>
      </section>

      <section id="generation-jobs" className="scroll-mt-3 space-y-2 rounded border border-white/10 p-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">BytePlus 생성 작업</h3><span className="text-xs text-gray-400">서버 저장소 조회 결과</span></div>
        <div id="generation-submit" className="scroll-mt-3 flex flex-wrap gap-2">
          <button className={buttonClass} onClick={submitAuthorizedAttempt} disabled={project.workflow.generationApproval.status !== 'approved'}>승인된 생성 시도 제출</button>
          <button className={buttonClass} onClick={refreshGenerations}>상태 새로고침</button>
          <button className={buttonClass} onClick={() => setPreviewRefreshNonce((value) => value + 1)} disabled={!generatedAssetKey || !apiToken}>미리보기 새로고침</button>
        </div>
        <p className="text-xs text-gray-400">GET 요청은 읽기 전용입니다. 폴링과 결과 수집은 작업자가 처리합니다. 공급자 작업이 성공해도 미디어가 타임라인에 자동 추가되지는 않습니다.</p>
        <div className="space-y-2">
          {generationRecords.length === 0 && <p className="text-xs text-gray-500">불러온 서버 생성 접수 내역이 없습니다.</p>}
          {generationRecords.map((generation) => (
            <div key={generation.requestKey} className="rounded border border-white/10 bg-black/20 p-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><strong>{generation.job.status}</strong> · {generation.job.model}</span>
                <span className="break-all text-gray-500">{generation.requestKey.slice(0, 16)}…</span>
              </div>
              {generation.job.lastError && <p className="mt-1 text-red-300">{generation.job.lastError}</p>}
              {generation.job.status === 'ready' && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className={buttonClass} onClick={() => registerReadyCandidate(generation)}>품질 검수 대기 테이크 등록</button>
                  <button className={buttonClass} onClick={() => approveAndImportReadyTake(generation)}>승인 후 영구 저장</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2 rounded border border-white/10 p-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">제작 명세</h3><span className="text-xs text-gray-400">자산 {project.workflow.production.assets.length} · 잠금 {project.workflow.production.continuityLocks.length} · 샷 {project.workflow.production.shotSpecs.length} · 테이크 {project.workflow.production.takes.length}</span></div>
        <p className="text-xs text-gray-400">자산 레지스트리 V2, 연속성 잠금, 구조화된 샷 명세와 테이크 이력을 관리합니다.</p>
        <textarea className={`${fieldClass} min-h-32 font-mono text-xs`} value={productionJson} onChange={(event) => setProductionJson(event.target.value)} placeholder='{"assets":[],"continuityLocks":[],"shotSpecs":[],"takes":[]}' />
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} onClick={() => setProductionJson(JSON.stringify(project.workflow.production, null, 2))}>현재 JSON 불러오기</button>
          <button className={buttonClass} onClick={generateFromStoryboard} disabled={!project.workflow.storyboard}>스토리보드에서 생성</button>
          <button className={buttonClass} onClick={importProductionManifest} disabled={!productionJson.trim()}>명세 적용</button>
        </div>
        <select className={fieldClass} value={selectedShotSpecId} onChange={(event) => setSelectedShotSpecId(event.target.value)}>
          <option value="">생성 준비가 완료된 샷 선택</option>
          {project.workflow.production.shotSpecs.map((shot) => <option key={shot.id} value={shot.id}>{shot.id} · {shot.durationSeconds}s</option>)}
        </select>
        {selectedShotSpecId && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-xs text-gray-200">{compiledPrompt}</pre>}
        <div className="space-y-1">
          {project.workflow.production.assets.map((asset) => {
            const passed = asset.stressTests.filter((test) => test.verdict === 'pass').length;
            const ready = asset.status === 'locked' && passed === 10;
            return (
              <details key={asset.id} className="rounded bg-white/5 px-2 py-1 text-xs">
                <summary className="cursor-pointer list-none">
                  <span className="flex items-center justify-between gap-2">
                    <span>{ready ? '🔒' : asset.status === 'locked' ? '⚠️' : '◌'} {asset.tag} · {asset.type} · {asset.state}</span>
                    <span className={ready ? 'text-green-400' : 'text-red-300'}>검사 {passed}/10 통과</span>
                  </span>
                </summary>
                {asset.stressTests.length === 0 ? <p className="mt-1 text-gray-500">아직 안정성 검사가 없습니다. 자산을 잠그려면 10개 검사를 모두 통과해야 합니다.</p> : (
                  <ul className="mt-1 space-y-0.5">
                    {asset.stressTests.map((test) => (
                      <li key={test.id} className="flex justify-between gap-2">
                        <span>{test.pose} · {test.lighting}{test.coAssetIds.length ? ` · co: ${test.coAssetIds.join(', ')}` : ''}</span>
                        <span className={test.verdict === 'pass' ? 'text-green-400' : test.verdict === 'reject' ? 'text-red-400' : 'text-yellow-300'}>{test.verdict}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            );
          })}
        </div>
        <div className="space-y-2 border-t border-white/10 pt-2">
          <h4 className="font-semibold text-xs">수동 테이크 기록 — 공급자 제출 없음</h4>
          <p className="text-xs text-gray-500">서버 생성 후보는 위 BytePlus 생성 작업을 통해 들어옵니다. 이 양식은 기존 또는 수동 작업 이력만 기록합니다.</p>
          <div className="grid grid-cols-2 gap-2">
            <select className={fieldClass} value={takeShotSpecId} onChange={(event) => setTakeShotSpecId(event.target.value)}>
              <option value="">샷 명세</option>
              {project.workflow.production.shotSpecs.map((shot) => <option key={shot.id} value={shot.id}>{shot.id}</option>)}
            </select>
            <select className={fieldClass} value={takeVerdict} onChange={(event) => setTakeVerdict(event.target.value as GenerationTake['verdict'])}>
              {['pending', 'accepted', 'bad-roll', 'prompt-problem', 'simplify-shot', 'rejected'].map((value) => <option key={value} value={value}>{{pending: '대기', accepted: '승인', 'bad-roll': '사용 불가', 'prompt-problem': '프롬프트 문제', 'simplify-shot': '샷 단순화', rejected: '거절'}[value]}</option>)}
            </select>
            <input className={fieldClass} value={takeProvider} onChange={(event) => setTakeProvider(event.target.value)} placeholder="공급자(byteplus)" />
            <input className={fieldClass} value={takeModel} onChange={(event) => setTakeModel(event.target.value)} placeholder="모델(dreamina-seedance-2-5-260628)" />
            <select className={fieldClass} value={takeMode} onChange={(event) => setTakeMode(event.target.value)}>
              {['t2v', 'omni_reference', 'video_edit', 'video_extension'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select className={fieldClass} value={takeResolution} onChange={(event) => setTakeResolution(event.target.value)}>
              {['720p', '480p'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <input className={fieldClass} value={takeExtensionMode} onChange={(event) => setTakeExtensionMode(event.target.value)} placeholder="연장 방향(forward/backward — video_extension 전용)" />
            <input className={fieldClass} value={takeOutputAssetId} onChange={(event) => setTakeOutputAssetId(event.target.value)} placeholder="출력 자산 ID(선택)" />
            <input className={fieldClass} value={takeParentId} onChange={(event) => setTakeParentId(event.target.value)} placeholder="상위 테이크 ID(재생성)" />
          </div>
          <input className={fieldClass} value={takeUrl} onChange={(event) => setTakeUrl(event.target.value)} placeholder="생성된 클립 URL(선택, 자산으로 등록)" />
          <button className={buttonClass} onClick={recordTake} disabled={!takeShotSpecId}>테이크 기록</button>
        </div>
        {project.workflow.production.takes.length > 0 && <div className="space-y-1">
          {project.workflow.production.takes.slice(-8).reverse().map((take) => {
            const media = take.outputAssetId ? project.mediaFiles.find((item) => item.id === take.outputAssetId) : undefined;
            const asset = take.outputAssetId ? project.workflow.higgsfieldAssets.find((item) => item.id === take.outputAssetId) : undefined;
            return (
              <div key={take.id} className={`rounded px-2 py-1 text-xs ${take.selected ? 'bg-white/15 ring-1 ring-white/30' : 'bg-white/5'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{take.verdict}{take.selected ? ' ●' : ''}</span>
                  <span className="flex items-center gap-2">
                    <button className="text-blue-300 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-30" disabled={take.verdict !== 'accepted'} onClick={() => selectTake(take.id)} title="승인된 테이크를 대표 버전으로 지정">{take.selected ? '선택됨' : '선택'}</button>
                    <button className="text-yellow-300 hover:text-yellow-200" onClick={() => retakeTake(take.id)}>다시 생성</button>
                    {media ? <span className="text-gray-400">@ {media.positionStart.toFixed(1)}s</span>
                      : asset ? <button className="text-green-300 hover:text-green-200" onClick={() => addTakeToTimeline(take.id)}>+ 타임라인</button>
                      : <span className="text-gray-500">클립 없음</span>}
                  </span>
                </div>
                <div className="text-gray-500">{take.shotSpecId} · {take.model}{take.parentTakeId ? ` · child of ${take.parentTakeId.slice(0, 8)}…` : ''}</div>
              </div>
            );
          })}
        </div>}
      </section>

      <SeedanceMasterPanel />

      <section className="space-y-2 rounded border border-white/10 p-3">
        <h3 className="font-semibold">기존 Higgsfield 가져오기 — 마이그레이션 전용</h3>
        <p className="text-xs text-yellow-300">가져온 URL은 외부 미검증 상태로 유지되며, 안전한 수집 절차를 통과하기 전에는 최종 승인을 받을 수 없습니다.</p>
        <input className={fieldClass} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="기존 HTTPS 결과 URL" />
        <div className="grid grid-cols-2 gap-2"><input className={fieldClass} value={cutId} onChange={(event) => setCutId(event.target.value)} /><input className={fieldClass} value={shotId} onChange={(event) => setShotId(event.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2"><input className={fieldClass} value={model} onChange={(event) => setModel(event.target.value)} /><input className={fieldClass} type="number" min={0.1} step={0.1} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></div>
        <select className={fieldClass} value={role} onChange={(event) => setRole(event.target.value as HiggsfieldAsset['role'])}>
          {['clip', 'audio', 'start', 'end', 'storyboard-sheet'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <button className={buttonClass} onClick={importHiggsfield} disabled={!url}>기존 스토리보드 연결 {role} 가져오기</button>
      </section>

      <section className="space-y-2 border-t border-white/10 pt-3">
        <h3 className="font-semibold">후반 작업 최종 설정</h3>
        <p className="text-xs text-gray-400">검수한 한국어 대사를 오디오와 정확한 자막에 연결하고, 검증된 앱 UI 미디어와 실제 엔딩 카드 텍스트 요소를 연결하세요. 생성 영상은 모든 점검 항목을 충족해야 합니다.</p>
        <textarea className={`${fieldClass} min-h-40 font-mono text-xs`} value={postProductionJson} onChange={(event) => setPostProductionJson(event.target.value)} placeholder='{"sourceAudioPolicy":"mute","dialogueCues":[],"ambience":[],"sfx":[],"bgm":[],"appUiOverlays":[],"releaseChecklist":{}}' />
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} onClick={() => setPostProductionJson(JSON.stringify(project.workflow.postProduction, null, 2))}>현재 설정 불러오기</button>
          <button className={buttonClass} onClick={importPostProduction} disabled={!postProductionJson.trim()}>설정 적용</button>
          <button className={buttonClass} onClick={stagePostProductionMedia} disabled={!apiToken || !approvalToken}>참조한 로컬 미디어 준비</button>
        </div>
        <p className="text-xs text-gray-500">최종 승인 전에 로컬 TTS·환경음·효과음·배경음악·앱 UI 파일을 준비해야 서버 렌더 작업자가 자산 ID로 찾을 수 있습니다.</p>
      </section>

      <section className="space-y-2 border-t border-white/10 pt-3">
        <h3 className="font-semibold">한국어 자막(SRT)</h3>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={project.exportSettings.includeSubtitles} onChange={(event) => dispatch(setIncludeSubtitles(event.target.checked))} /> 미리보기와 렌더링에 자막 포함</label>
        <textarea className={`${fieldClass} min-h-24`} value={srt} onChange={(event) => setSrt(event.target.value)} placeholder={'1\n00:00:00,000 --> 00:00:02,000\n한국어 자막'} />
        <button className={buttonClass} onClick={importSrt} disabled={!srt}>SRT 가져오기</button>
        <div className="mt-3 border-t border-white/10 pt-3">
          <h4 className="mb-2 font-semibold">자막 목록 · Noto Sans KR</h4>
          <input className={fieldClass} value={captionText} onChange={(event) => setCaptionText(event.target.value)} placeholder="대사·효과·예능 자막 문구" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <select className={fieldClass} value={captionKind} onChange={(event) => { const kind = event.target.value as CaptionKind; setCaptionKind(kind); setCaptionPreset(CAPTION_CATALOG.find((entry) => entry.kind === kind)!.preset); }}>
              <option value="dialogue">대사자막</option><option value="effect">효과자막</option><option value="variety">예능자막</option>
            </select>
            <select className={fieldClass} value={captionPreset} onChange={(event) => setCaptionPreset(event.target.value as CaptionPreset)}>{CAPTION_CATALOG.filter((entry) => entry.kind === captionKind).map((entry) => <option key={entry.preset} value={entry.preset}>{entry.label}</option>)}</select>
            <select className={fieldClass} value={captionPosition} onChange={(event) => setCaptionPosition(event.target.value as CaptionPosition)}>{['top', 'center', 'bottom', 'lower-third'].map((value) => <option key={value}>{value}</option>)}</select>
            <input className={fieldClass} type="color" value={captionAccent} onChange={(event) => setCaptionAccent(event.target.value)} aria-label="자막 강조 색상" />
            <input className={fieldClass} type="number" min={0} step={0.1} value={captionStart} onChange={(event) => setCaptionStart(Number(event.target.value))} aria-label="자막 시작 시간(초)" />
            <input className={fieldClass} type="number" min={0.1} step={0.1} value={captionEnd} onChange={(event) => setCaptionEnd(Number(event.target.value))} aria-label="자막 종료 시간(초)" />
          </div>
          <label className="mt-2 block text-xs text-gray-400">강도 {captionIntensity.toFixed(2)}<input className="w-full" type="range" min={0} max={1} step={0.05} value={captionIntensity} onChange={(event) => setCaptionIntensity(Number(event.target.value))} /></label>
          <button className={`${buttonClass} mt-2`} onClick={addCaption} disabled={!captionText.trim()}>자막 추가</button>
        </div>
      </section>

      <section className="space-y-2 rounded border border-white/10 p-3">
        <h3 className="font-semibold">프레임 단위 전환 효과</h3>
        <select className={fieldClass} value={transitionType} onChange={(event) => setTransitionType(event.target.value as TransitionSpec['type'])}>{TRANSITION_CATALOG.map((entry) => <option key={entry.type} value={entry.type}>{entry.label} · {entry.provider}</option>)}</select>
        <div className="grid grid-cols-2 gap-2">
          <select className={fieldClass} value={fromMediaId} onChange={(event) => setFromMediaId(event.target.value)}><option value="">시작 클립</option>{project.mediaFiles.filter((media) => media.type === 'video' || media.type === 'image').map((media) => <option key={media.id} value={media.id}>{media.fileName}</option>)}</select>
          <select className={fieldClass} value={toMediaId} onChange={(event) => setToMediaId(event.target.value)}><option value="">다음 클립</option>{project.mediaFiles.filter((media) => media.type === 'video' || media.type === 'image').map((media) => <option key={media.id} value={media.id}>{media.fileName}</option>)}</select>
        </div>
        <input className={fieldClass} type="number" min={0.05} max={3} step={0.05} value={transitionDuration} onChange={(event) => setTransitionDuration(Number(event.target.value))} />
        <button className={buttonClass} onClick={addTransition} disabled={!fromMediaId || !toMediaId}>전환 효과 추가</button>
      </section>

      <section className="space-y-2 rounded border border-white/10 p-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Remotion 효과</h3><span className="text-xs text-gray-400">{project.workflow.effects.length}/1000</span></div>
        <select className={fieldClass} value={effectType} onChange={(event) => setEffectType(event.target.value as EffectSpec['type'])}>
          {EFFECT_CATALOG.map((effect) => <option key={effect.type} value={effect.type}>{effect.label}</option>)}
        </select>
        <select className={fieldClass} value={effectMediaId} onChange={(event) => setEffectMediaId(event.target.value)}>
          <option value="">대상 클립</option>
          {project.mediaFiles.filter((media) => media.type === 'video' || media.type === 'image').map((media) => <option key={media.id} value={media.id}>{media.fileName}</option>)}
        </select>
        <label className="block text-xs text-gray-400">강도 {effectIntensity.toFixed(2)}<input className="w-full" type="range" min={0} max={1} step={0.05} value={effectIntensity} onChange={(event) => setEffectIntensity(Number(event.target.value))} /></label>
        <button className={buttonClass} onClick={addEffect} disabled={!effectMediaId}>전체 클립에 효과 추가</button>
        {project.workflow.effects.length > 0 && <div className="space-y-1 pt-1">{project.workflow.effects.map((effect) => {
          const media = project.mediaFiles.find((item) => item.id === effect.targetMediaId);
          return <div key={effect.id} className="flex items-center justify-between rounded bg-white/5 px-2 py-1 text-xs"><span>{effect.type} · {media?.fileName ?? effect.targetMediaId} · {effect.intensity.toFixed(2)}</span><button className="text-red-300 hover:text-red-200" onClick={() => removeEffect(effect.id)}>제거</button></div>;
        })}</div>}
      </section>

      <section className="space-y-2 rounded border border-white/10 p-3">
        <h3 className="font-semibold">프로젝트 JSON</h3>
        <button className={buttonClass} onClick={() => downloadProjectDocument(project)}>프로젝트 내보내기</button>
        <label className={`${buttonClass} ml-2 inline-block cursor-pointer`}>프로젝트 가져오기<input className="hidden" type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && importProject(event.target.files[0])} /></label>
      </section>

      <section className="space-y-2 rounded border border-white/10 p-3">
        <h3 className="font-semibold">Remotion 최종 렌더링</h3>
        <input className={fieldClass} type="password" value={apiToken} onChange={(event) => setApiToken(event.target.value)} placeholder="CLIPJS_AGENT_TOKEN(운영 환경)" />
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} onClick={approveRelease} disabled={rendering}>현재 최종 편집본 승인</button>
          <button className={buttonClass} onClick={renderProject} disabled={rendering || project.workflow.releaseApproval.status !== 'approved'}>{rendering ? '렌더링 중…' : renderRetryRequired ? '렌더링 다시 시도' : '승인된 프로젝트 렌더링'}</button>
        </div>
        {renderDownloadUrl && <a className={`${buttonClass} inline-block`} href={renderDownloadUrl} download>렌더링된 MP4 내려받기</a>}
      </section>
    </div>
  );
}
