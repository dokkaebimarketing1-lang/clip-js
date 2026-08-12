"use client";

import {useEffect, useMemo, useRef, useState} from 'react';
import toast from 'react-hot-toast';
import {commitProjectMutation, getFile, getProject, useAppDispatch, useAppSelector} from '@/app/store';
import {rehydrate, setIncludeSubtitles, setMediaFiles, setWorkflow} from '@/app/store/slices/projectSlice';

import {creativeApprovalSchema, generationApprovalSchema, postProductionSchema, productionManifestSchema, releaseApprovalSchema, storyboardSchema, type CaptionKind, type CaptionPosition, type CaptionPreset, type EffectSpec, type GenerationTake, type HiggsfieldAsset, type TransitionSpec} from '@/app/lib/workflow/schema';
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
import {prepareApprovedTakeImport, upsertQcPendingTake} from '@/app/lib/workflow/generated-take';
import {takeApprovalSchema} from '@/app/lib/workflow/production-schema';
import SeedanceMasterPanel from './SeedanceMasterPanel';

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
      toast.success('Storyboard imported. Previous approval was invalidated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid storyboard JSON.');
    }
  };

  const importProductionManifest = () => {
    try {
      const production = productionManifestSchema.parse(JSON.parse(productionJson));
      dispatch(setWorkflow({...project.workflow, production}));
      setSelectedShotSpecId(production.shotSpecs[0]?.id ?? '');
      toast.success('Production manifest applied. Previous approval was invalidated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid production manifest JSON.');
    }
  };

  const importPostProduction = () => {
    try {
      const postProduction = postProductionSchema.parse(JSON.parse(postProductionJson));
      dispatch(setWorkflow({...project.workflow, postProduction}));
      toast.success('Post-production recipe applied; release approval was invalidated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid post-production JSON.');
    }
  };

  const stagePostProductionMedia = async () => {
    if (!apiToken || !approvalToken) return toast.error('Agent token과 owner approval token이 필요합니다.');
    const post = project.workflow.postProduction;
    const referenced = new Set([
      ...post.dialogueCues.map((cue) => cue.mediaId),
      ...post.ambience.map((lane) => lane.mediaId),
      ...post.sfx.map((lane) => lane.mediaId),
      ...post.bgm.map((lane) => lane.mediaId),
      ...post.appUiOverlays.map((overlay) => overlay.mediaId),
    ]);
    const candidates = project.mediaFiles.filter((media) => referenced.has(media.id) && media.source?.kind === 'indexeddb');
    if (!candidates.length) return toast.success('승격할 local post-production media가 없습니다.');
    try {
      const replacements = new Map<string, {assetId: string; contentSha256: string}>();
      for (const media of candidates) {
        if (!['video', 'audio', 'image'].includes(media.type)) throw new Error(`Media ${media.id} type is unsupported.`);
        const fileId = media.source?.kind === 'indexeddb' ? media.source.fileId : media.fileId;
        if (!fileId) throw new Error(`Media ${media.id} has no IndexedDB file.`);
        const file = await getFile(fileId);
        if (!file) throw new Error(`Media ${media.id} file is missing.`);
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
          throw new Error(result.error || `Media ${media.id} upload failed.`);
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
      toast.success(`${replacements.size}개 post-production media를 server asset으로 승격했습니다.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Post-production media 승격에 실패했습니다.');
    }
  };

  const generateFromStoryboard = () => {
    if (!project.workflow.storyboard) { toast.error('Import a storyboard first.'); return; }
    const derived = deriveProductionFromStoryboard(project.workflow.storyboard, project.workflow.production);
    setProductionJson(JSON.stringify(derived, null, 2));
    toast.success(`Generated ${derived.shotSpecs.length} shot specs and ${derived.continuityLocks.length} continuity locks — review, then Apply.`);
  };

  const approve = async () => {
    if (!project.workflow.storyboard) return toast.error('Import a storyboard first.');
    try {
      const response = await fetch('/api/approval/storyboard', {
        method: 'POST',
        headers: {'content-type': 'application/json', ...(approvalToken ? {'x-clipjs-approval-token': approvalToken} : {})},
        body: JSON.stringify({projectId: project.id, storyboard: project.workflow.storyboard}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Approval failed.');
      const creativeApproval = creativeApprovalSchema.parse(result.creativeApproval);
      dispatch(setWorkflow({...project.workflow, creativeApproval}));
      setAuthorizationPreview(null);
      setApprovalToken('');
      toast.success('The exact storyboard is creative-approved and server-signed.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Approval failed.');
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
      if (!response.ok) throw new Error(result.error || 'Generation authorization preview failed.');
      setAuthorizationPreview(result as AuthorizationPreviewUi);
      toast.success('Canonical BytePlus request preview is ready. No provider call was made.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Generation authorization preview failed.');
    }
  };

  const authorizeGeneration = async () => {
    if (!authorizationPreview || authorizationPreview.attemptId !== attemptId) return toast.error('Preview this attempt first.');
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/generation-authorization/sign`, {
        method: 'POST',
        headers: {'content-type': 'application/json', ...(approvalToken ? {'x-clipjs-approval-token': approvalToken} : {})},
        body: JSON.stringify({attemptId, expectedRequestHash: authorizationPreview.requestHash, project}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Generation authorization failed.');
      const generationApproval = generationApprovalSchema.parse(result.generationApproval);
      dispatch(setWorkflow({...project.workflow, generationApproval}));
      setApprovalToken('');
      toast.success('This exact attempt and BytePlus request are authorized. No provider call was made.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Generation authorization failed.');
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
      if (!response.ok) throw new Error(result.error || 'Generation status refresh failed.');
      setGenerationRecords(Array.isArray(result.generations) ? result.generations as GenerationProjectionUi[] : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Generation status refresh failed.');
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
      if (!response.ok) throw new Error(result.error || 'Generation submission failed.');
      setGenerationRecords((records) => [result.generation as GenerationProjectionUi, ...records.filter((item) => item.requestKey !== result.generation.requestKey)]);
      toast.success(result.reused ? 'Existing generation receipt reused; no provider resubmission.' : 'Generation claim submitted once.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Generation submission failed.');
    }
  };

  const registerReadyCandidate = (generation: GenerationProjectionUi) => {
    const job = generation.job;
    if (job.status !== 'ready' || !job.takeId || !job.assetId || !job.contentSha256 || !job.providerJobId) return toast.error('Generation is not ready for QC.');
    const next = upsertQcPendingTake(project, {
      requestKey: generation.requestKey,
      claim: {projectId: generation.projectId},
      job: {
        status: 'ready', takeId: job.takeId, assetId: job.assetId, contentSha256: job.contentSha256,
        authorizedResolution: job.authorizedResolution, providerJobId: job.providerJobId, model: job.model, updatedAt: job.updatedAt,
        takeScope: job.takeScope, targetShotSpecId: job.targetShotSpecId,
      },
    });
    dispatch(rehydrate(next));
    toast.success('Candidate registered as qc_pending. No timeline media was added.');
  };

  const approveAndImportReadyTake = async (generation: GenerationProjectionUi) => {
    const job = generation.job;
    if (job.status !== 'ready' || !job.takeId || !job.assetId || !job.contentSha256) return toast.error('Generation is not ready for Take approval.');
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
      if (!approveResponse.ok) throw new Error(approveResult.error || 'Take approval failed.');
      const takeApproval = takeApprovalSchema.parse(approveResult.takeApproval);
      const persisted = await getProject(project.id);
      if (!persisted?.workflow.production.takes.some((take) => take.id === job.takeId)) throw new Error('Save the qc_pending candidate before approving it.');
      if (!job.actualDurationSeconds) throw new Error('Ready generation is missing verified duration metadata.');
      const committed = await commitProjectMutation(project.id, persisted.revision, (current) => prepareApprovedTakeImport(current, job.takeId!, takeApproval, job.actualDurationSeconds!));
      let previewUrl: string | undefined;
      const capabilityResponse = await fetch(`/api/projects/${encodeURIComponent(project.id)}/assets/${encodeURIComponent(job.assetId)}/capability`, {
        method: 'POST', headers: apiToken ? {authorization: ['Bear', 'er ', apiToken].join('')} : {},
      });
      if (capabilityResponse.ok) previewUrl = (await capabilityResponse.json()).url;
      const runtime = previewUrl ? {...committed, mediaFiles: committed.mediaFiles.map((media) => media.takeId === job.takeId ? {...media, src: previewUrl} : media)} : committed;
      dispatch(rehydrate(runtime));
      toast.success('Take approval committed durably; one timeline placement was added.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Take import failed.');
    }
  };

  const importHiggsfield = () => {
    try {
      const safeUrl = assertSafeRemoteUrl(url).toString();
      const cut = project.workflow.storyboard?.cuts.find((item) => item.id === cutId);
      const shot = cut?.shots.find((item) => item.id === shotId);
      if (!cut || !shot) {
        throw new Error('Cut/shot must exist in the imported storyboard.');
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
      toast.success(`${cutId}/${shotId} Higgsfield ${role} imported at ${positionStart.toFixed(2)}s.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not import Higgsfield media.');
    }
  };

  const importProject = async (file: File) => {
    try {
      const parsed = importProjectIntoCurrentProject(parseProjectDocument(JSON.parse(await file.text())), project.id);
      const mediaFiles = await Promise.all(parsed.mediaFiles.map(async (media) => {
        if (media.source?.kind === 'generated' || media.source?.kind === 'managed') return media;
        if (media.remoteUrl) return {...media, src: media.remoteUrl};
        const fileId = media.source?.kind === 'indexeddb' ? media.source.fileId : media.fileId;
        if (!fileId) throw new Error(`Media ${media.id} is not stored in IndexedDB.`);
        const stored = await getFile(fileId);
        return stored ? {...media, src: URL.createObjectURL(stored)} : media;
      }));
      dispatch(rehydrate({...parsed, mediaFiles}));
      toast.success('Project JSON imported.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid project file.');
    }
  };

  const importSrt = () => {
    try {
      dispatch(setWorkflow({...project.workflow, captions: parseSrt(srt)}));
      dispatch(setIncludeSubtitles(true));
      toast.success('Korean captions imported.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid SRT.');
    }
  };

  const addCaption = () => {
    if (!captionText.trim()) return toast.error('Enter caption text.');
    if (captionEnd <= captionStart) return toast.error('Caption end must be after start.');
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
    toast.success(`${captionKind} caption added.`);
  };

  const addTransition = () => {
    if (!fromMediaId || !toMediaId || fromMediaId === toMediaId) return toast.error('Choose two different media clips.');
    const transition: TransitionSpec = {
      id: crypto.randomUUID(),
      type: transitionType,
      provider: transitionProviderFor(transitionType),
      fromMediaId,
      toMediaId,
      durationSeconds: transitionDuration,
    };
    dispatch(setWorkflow({...project.workflow, transitions: [...project.workflow.transitions, transition]}));
    toast.success(`${transitionType} transition added.`);
  };

  const addEffect = () => {
    const media = project.mediaFiles.find((item) => item.id === effectMediaId);
    if (!media || !['video', 'image'].includes(media.type)) return toast.error('Choose a visual media clip.');
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
    toast.success(`${effectType} effect added to ${media.fileName}.`);
  };

  const removeEffect = (effectId: string) => {
    dispatch(setWorkflow({...project.workflow, effects: project.workflow.effects.filter((effect) => effect.id !== effectId)}));
  };

  const recordTake = async () => {
    if (!takeShotSpecId) { toast.error('Choose a generation-ready shot first.'); return; }
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
      toast.success(`${takeVerdict} take recorded for ${takeShotSpecId}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not record take.');
    }
  };

  const selectTake = (takeId: string) => {
    const take = project.workflow.production.takes.find((item) => item.id === takeId);
    if (!take || take.verdict !== 'accepted') return;
    const takes = project.workflow.production.takes.map((item) => item.id === takeId
      ? {...item, selected: true}
      : item.shotSpecId === take.shotSpecId ? {...item, selected: false} : item);
    dispatch(setWorkflow({...project.workflow, production: {...project.workflow.production, takes}}));
    toast.success(`Take ${take.id.slice(0, 8)}… promoted. Re-approve before rendering.`);
  };

  const retakeTake = (takeId: string) => {
    const take = project.workflow.production.takes.find((item) => item.id === takeId);
    if (!take) return;
    setTakeShotSpecId(take.shotSpecId ?? '');
    setTakeParentId(take.id);
    toast.success(`Retake form pre-filled for ${take.scope === 'production' ? 'production scope' : take.shotSpecId} (parent ${take.id.slice(0, 8)}…).`);
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
      toast.success(`Take clip is already on the timeline at ${media?.positionStart.toFixed(2)}s.`);
      return;
    }
    if (!result.media) { toast.error('Take has no clip URL — import it with the Higgsfield importer first.'); return; }
    dispatch(setMediaFiles([...project.mediaFiles, result.media]));
    toast.success(`Take clip placed on the timeline at ${result.media.positionStart.toFixed(2)}s.`);
  };

  const approveRelease = async () => {
    try {
      const response = await fetch('/api/approval/release', {
        method: 'POST',
        headers: {'content-type': 'application/json', ...(approvalToken ? {'x-clipjs-approval-token': approvalToken} : {})},
        body: JSON.stringify({project}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Release approval failed.');
      const releaseApproval = releaseApprovalSchema.parse(result);
      dispatch(setWorkflow({...project.workflow, releaseApproval}));
      setApprovalToken('');
      toast.success('The exact timeline, media, captions, audio, effects, and export settings are release-approved.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Release approval failed.');
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
        throw new Error(receipt.error || 'Render enqueue failed.');
      }
      setRenderRetryRequired(false);
      if (typeof receipt.statusUrl !== 'string') throw new Error('Render receipt has no status URL.');
      toast.success(receipt.reused ? 'Existing render job resumed.' : 'Durable render job queued.');
      for (let attempt = 0; attempt < 360; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const statusResponse = await fetch(receipt.statusUrl, {headers: authorization ? {authorization} : {}});
        const statusResult = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(statusResult.error || 'Render status failed.');
        if (statusResult.status === 'succeeded') {
          setRenderDownloadUrl(normalizeRenderDownloadUrl(statusResult.downloadUrl, window.location.origin));
          setApiToken('');
          setApprovalToken('');
          toast.success('Remotion render completed. Use the download link below.');
          return;
        }
        if (statusResult.status === 'failed' || statusResult.status === 'cancelled' || statusResult.status === 'expired') {
          setRenderRetryRequired(true);
          throw new Error(statusResult.error || `Render ${statusResult.status}. Explicit retry is required.`);
        }
      }
      throw new Error('Render is still running. Refresh status later; the durable worker job was not cancelled.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Render failed.');
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="space-y-6 text-sm">
      <section className="space-y-2 rounded border border-white/10 p-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Approval gate</h3><span className="rounded bg-white/10 px-2 py-1 text-xs">{approvalLabel}</span></div>
        <textarea className={`${fieldClass} min-h-32`} value={storyboardJson} onChange={(event) => setStoryboardJson(event.target.value)} placeholder="Paste storyboard-v2 JSON" />
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} onClick={importStoryboard}>Import storyboard</button>
          <button className={buttonClass} onClick={approve} disabled={!project.workflow.storyboard}>Creative approve</button>
          <button className={buttonClass} onClick={startNewAttempt}>New paid attempt</button>
          <button className={buttonClass} onClick={previewGenerationAuthorization} disabled={project.workflow.creativeApproval.status !== 'approved'}>Preview BytePlus request</button>
          <button className={buttonClass} onClick={authorizeGeneration} disabled={!authorizationPreview}>Authorize exact attempt</button>
        </div>
        <div className="rounded bg-black/30 p-2 text-xs text-gray-300">Attempt <code>{attemptId}</code></div>
        {authorizationPreview && (
          <details className="rounded border border-white/10 bg-black/20 p-2 text-xs">
            <summary className="cursor-pointer font-semibold">{authorizationPreview.model} · {authorizationPreview.task} · {authorizationPreview.duration}s · {authorizationPreview.ratio} · {authorizationPreview.resolution} · refs {authorizationPreview.referenceCount}</summary>
            <p className="mt-2 break-all text-gray-400">requestKey {authorizationPreview.requestKey}</p>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-gray-300">{authorizationPreview.promptPreview}</pre>
          </details>
        )}
        <input className={fieldClass} type="password" autoComplete="off" value={approvalToken} onChange={(event) => setApprovalToken(event.target.value)} placeholder="Owner approval token (production)" />
        <p className="text-xs text-gray-400">Creative approval, paid generation authorization, take approval, and release approval are separate. Preview/sign never calls BytePlus.</p>
      </section>

      <section className="space-y-2 rounded border border-white/10 p-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">BytePlus generation jobs</h3><span className="text-xs text-gray-400">server repository projection</span></div>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} onClick={submitAuthorizedAttempt} disabled={project.workflow.generationApproval.status !== 'approved'}>Submit authorized attempt</button>
          <button className={buttonClass} onClick={refreshGenerations}>Refresh status</button>
          <button className={buttonClass} onClick={() => setPreviewRefreshNonce((value) => value + 1)} disabled={!generatedAssetKey || !apiToken}>Refresh previews</button>
        </div>
        <p className="text-xs text-gray-400">GET is read-only. Polling and ingest are owned by the lease worker. Provider success never auto-adds timeline media.</p>
        <div className="space-y-2">
          {generationRecords.length === 0 && <p className="text-xs text-gray-500">No server generation receipts loaded.</p>}
          {generationRecords.map((generation) => (
            <div key={generation.requestKey} className="rounded border border-white/10 bg-black/20 p-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><strong>{generation.job.status}</strong> · {generation.job.model}</span>
                <span className="break-all text-gray-500">{generation.requestKey.slice(0, 16)}…</span>
              </div>
              {generation.job.lastError && <p className="mt-1 text-red-300">{generation.job.lastError}</p>}
              {generation.job.status === 'ready' && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className={buttonClass} onClick={() => registerReadyCandidate(generation)}>Register qc_pending Take</button>
                  <button className={buttonClass} onClick={() => approveAndImportReadyTake(generation)}>Approve + durable import</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2 rounded border border-white/10 p-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Production blueprint</h3><span className="text-xs text-gray-400">{project.workflow.production.assets.length} assets · {project.workflow.production.continuityLocks.length} locks · {project.workflow.production.shotSpecs.length} shots · {project.workflow.production.takes.length} takes</span></div>
        <p className="text-xs text-gray-400">Bounded Asset Registry V2, continuity locks, structured shot specs, and take provenance.</p>
        <textarea className={`${fieldClass} min-h-32 font-mono text-xs`} value={productionJson} onChange={(event) => setProductionJson(event.target.value)} placeholder='{"assets":[],"continuityLocks":[],"shotSpecs":[],"takes":[]}' />
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} onClick={() => setProductionJson(JSON.stringify(project.workflow.production, null, 2))}>Load current JSON</button>
          <button className={buttonClass} onClick={generateFromStoryboard} disabled={!project.workflow.storyboard}>Generate from storyboard</button>
          <button className={buttonClass} onClick={importProductionManifest} disabled={!productionJson.trim()}>Apply manifest</button>
        </div>
        <select className={fieldClass} value={selectedShotSpecId} onChange={(event) => setSelectedShotSpecId(event.target.value)}>
          <option value="">Select generation-ready shot</option>
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
                    <span className={ready ? 'text-green-400' : 'text-red-300'}>{passed}/10 stress</span>
                  </span>
                </summary>
                {asset.stressTests.length === 0 ? <p className="mt-1 text-gray-500">No stress tests yet — locked assets require 10/10 passes.</p> : (
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
          <h4 className="font-semibold text-xs">Manual Take ledger — no provider submission</h4>
          <p className="text-xs text-gray-500">Server-generated candidates enter through BytePlus generation jobs above; this form only records legacy/manual provenance.</p>
          <div className="grid grid-cols-2 gap-2">
            <select className={fieldClass} value={takeShotSpecId} onChange={(event) => setTakeShotSpecId(event.target.value)}>
              <option value="">Shot spec</option>
              {project.workflow.production.shotSpecs.map((shot) => <option key={shot.id} value={shot.id}>{shot.id}</option>)}
            </select>
            <select className={fieldClass} value={takeVerdict} onChange={(event) => setTakeVerdict(event.target.value as GenerationTake['verdict'])}>
              {['pending', 'accepted', 'bad-roll', 'prompt-problem', 'simplify-shot', 'rejected'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <input className={fieldClass} value={takeProvider} onChange={(event) => setTakeProvider(event.target.value)} placeholder="provider (byteplus)" />
            <input className={fieldClass} value={takeModel} onChange={(event) => setTakeModel(event.target.value)} placeholder="model (dreamina-seedance-2-5-260628)" />
            <select className={fieldClass} value={takeMode} onChange={(event) => setTakeMode(event.target.value)}>
              {['t2v', 'omni_reference', 'video_edit', 'video_extension'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select className={fieldClass} value={takeResolution} onChange={(event) => setTakeResolution(event.target.value)}>
              {['720p', '480p'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <input className={fieldClass} value={takeExtensionMode} onChange={(event) => setTakeExtensionMode(event.target.value)} placeholder="extension_mode (forward/backward — video_extension 전용)" />
            <input className={fieldClass} value={takeOutputAssetId} onChange={(event) => setTakeOutputAssetId(event.target.value)} placeholder="output asset id (optional)" />
            <input className={fieldClass} value={takeParentId} onChange={(event) => setTakeParentId(event.target.value)} placeholder="parent take id (retake)" />
          </div>
          <input className={fieldClass} value={takeUrl} onChange={(event) => setTakeUrl(event.target.value)} placeholder="generated clip URL (optional, registers the asset)" />
          <button className={buttonClass} onClick={recordTake} disabled={!takeShotSpecId}>Record take</button>
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
                    <button className="text-blue-300 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-30" disabled={take.verdict !== 'accepted'} onClick={() => selectTake(take.id)} title="Promote the accepted take">{take.selected ? 'selected' : 'select'}</button>
                    <button className="text-yellow-300 hover:text-yellow-200" onClick={() => retakeTake(take.id)}>retake</button>
                    {media ? <span className="text-gray-400">@ {media.positionStart.toFixed(1)}s</span>
                      : asset ? <button className="text-green-300 hover:text-green-200" onClick={() => addTakeToTimeline(take.id)}>+ timeline</button>
                      : <span className="text-gray-500">no clip</span>}
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
        <h3 className="font-semibold">Legacy Higgsfield importer — migration only</h3>
        <p className="text-xs text-yellow-300">Imported URLs remain external-unverified and cannot receive ReleaseApproval until secure ingest promotes them.</p>
        <input className={fieldClass} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Legacy HTTPS result URL" />
        <div className="grid grid-cols-2 gap-2"><input className={fieldClass} value={cutId} onChange={(event) => setCutId(event.target.value)} /><input className={fieldClass} value={shotId} onChange={(event) => setShotId(event.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2"><input className={fieldClass} value={model} onChange={(event) => setModel(event.target.value)} /><input className={fieldClass} type="number" min={0.1} step={0.1} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></div>
        <select className={fieldClass} value={role} onChange={(event) => setRole(event.target.value as HiggsfieldAsset['role'])}>
          {['clip', 'audio', 'start', 'end', 'storyboard-sheet'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <button className={buttonClass} onClick={importHiggsfield} disabled={!url}>Import legacy storyboard-mapped {role}</button>
      </section>

      <section className="space-y-2 border-t border-white/10 pt-3">
        <h3 className="font-semibold">Post-production release recipe</h3>
        <p className="text-xs text-gray-400">Bind reviewed Korean dialogue to audio media and exact captions; bind verified app UI media and actual ending-card TextElements. All checklist flags are required for generated footage.</p>
        <textarea className={`${fieldClass} min-h-40 font-mono text-xs`} value={postProductionJson} onChange={(event) => setPostProductionJson(event.target.value)} placeholder='{"sourceAudioPolicy":"mute","dialogueCues":[],"ambience":[],"sfx":[],"bgm":[],"appUiOverlays":[],"releaseChecklist":{}}' />
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} onClick={() => setPostProductionJson(JSON.stringify(project.workflow.postProduction, null, 2))}>Load current recipe</button>
          <button className={buttonClass} onClick={importPostProduction} disabled={!postProductionJson.trim()}>Apply recipe</button>
          <button className={buttonClass} onClick={stagePostProductionMedia} disabled={!apiToken || !approvalToken}>Stage referenced local media</button>
        </div>
        <p className="text-xs text-gray-500">Local TTS, ambience, SFX, BGM, and app UI files must be staged before ReleaseApproval so the server render worker can resolve them by asset ID.</p>
      </section>

      <section className="space-y-2 border-t border-white/10 pt-3">
        <h3 className="font-semibold">Korean captions (SRT)</h3>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={project.exportSettings.includeSubtitles} onChange={(event) => dispatch(setIncludeSubtitles(event.target.checked))} /> Include captions in preview and render</label>
        <textarea className={`${fieldClass} min-h-24`} value={srt} onChange={(event) => setSrt(event.target.value)} placeholder={'1\n00:00:00,000 --> 00:00:02,000\n한국어 자막'} />
        <button className={buttonClass} onClick={importSrt} disabled={!srt}>Import SRT</button>
        <div className="mt-3 border-t border-white/10 pt-3">
          <h4 className="mb-2 font-semibold">Caption Registry · Noto Sans KR</h4>
          <input className={fieldClass} value={captionText} onChange={(event) => setCaptionText(event.target.value)} placeholder="대사·효과·예능 자막 문구" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <select className={fieldClass} value={captionKind} onChange={(event) => { const kind = event.target.value as CaptionKind; setCaptionKind(kind); setCaptionPreset(CAPTION_CATALOG.find((entry) => entry.kind === kind)!.preset); }}>
              <option value="dialogue">대사자막</option><option value="effect">효과자막</option><option value="variety">예능자막</option>
            </select>
            <select className={fieldClass} value={captionPreset} onChange={(event) => setCaptionPreset(event.target.value as CaptionPreset)}>{CAPTION_CATALOG.filter((entry) => entry.kind === captionKind).map((entry) => <option key={entry.preset} value={entry.preset}>{entry.label}</option>)}</select>
            <select className={fieldClass} value={captionPosition} onChange={(event) => setCaptionPosition(event.target.value as CaptionPosition)}>{['top', 'center', 'bottom', 'lower-third'].map((value) => <option key={value}>{value}</option>)}</select>
            <input className={fieldClass} type="color" value={captionAccent} onChange={(event) => setCaptionAccent(event.target.value)} aria-label="Caption accent color" />
            <input className={fieldClass} type="number" min={0} step={0.1} value={captionStart} onChange={(event) => setCaptionStart(Number(event.target.value))} aria-label="Caption start seconds" />
            <input className={fieldClass} type="number" min={0.1} step={0.1} value={captionEnd} onChange={(event) => setCaptionEnd(Number(event.target.value))} aria-label="Caption end seconds" />
          </div>
          <label className="mt-2 block text-xs text-gray-400">Intensity {captionIntensity.toFixed(2)}<input className="w-full" type="range" min={0} max={1} step={0.05} value={captionIntensity} onChange={(event) => setCaptionIntensity(Number(event.target.value))} /></label>
          <button className={`${buttonClass} mt-2`} onClick={addCaption} disabled={!captionText.trim()}>Add registry caption</button>
        </div>
      </section>

      <section className="space-y-2 rounded border border-white/10 p-3">
        <h3 className="font-semibold">Frame-accurate transition</h3>
        <select className={fieldClass} value={transitionType} onChange={(event) => setTransitionType(event.target.value as TransitionSpec['type'])}>{TRANSITION_CATALOG.map((entry) => <option key={entry.type} value={entry.type}>{entry.label} · {entry.provider}</option>)}</select>
        <div className="grid grid-cols-2 gap-2">
          <select className={fieldClass} value={fromMediaId} onChange={(event) => setFromMediaId(event.target.value)}><option value="">From clip</option>{project.mediaFiles.filter((media) => media.type === 'video' || media.type === 'image').map((media) => <option key={media.id} value={media.id}>{media.fileName}</option>)}</select>
          <select className={fieldClass} value={toMediaId} onChange={(event) => setToMediaId(event.target.value)}><option value="">To clip</option>{project.mediaFiles.filter((media) => media.type === 'video' || media.type === 'image').map((media) => <option key={media.id} value={media.id}>{media.fileName}</option>)}</select>
        </div>
        <input className={fieldClass} type="number" min={0.05} max={3} step={0.05} value={transitionDuration} onChange={(event) => setTransitionDuration(Number(event.target.value))} />
        <button className={buttonClass} onClick={addTransition} disabled={!fromMediaId || !toMediaId}>Add transition</button>
      </section>

      <section className="space-y-2 rounded border border-white/10 p-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Remotion effects</h3><span className="text-xs text-gray-400">{project.workflow.effects.length}/1000</span></div>
        <select className={fieldClass} value={effectType} onChange={(event) => setEffectType(event.target.value as EffectSpec['type'])}>
          {EFFECT_CATALOG.map((effect) => <option key={effect.type} value={effect.type}>{effect.label}</option>)}
        </select>
        <select className={fieldClass} value={effectMediaId} onChange={(event) => setEffectMediaId(event.target.value)}>
          <option value="">Target clip</option>
          {project.mediaFiles.filter((media) => media.type === 'video' || media.type === 'image').map((media) => <option key={media.id} value={media.id}>{media.fileName}</option>)}
        </select>
        <label className="block text-xs text-gray-400">Intensity {effectIntensity.toFixed(2)}<input className="w-full" type="range" min={0} max={1} step={0.05} value={effectIntensity} onChange={(event) => setEffectIntensity(Number(event.target.value))} /></label>
        <button className={buttonClass} onClick={addEffect} disabled={!effectMediaId}>Add effect to full clip</button>
        {project.workflow.effects.length > 0 && <div className="space-y-1 pt-1">{project.workflow.effects.map((effect) => {
          const media = project.mediaFiles.find((item) => item.id === effect.targetMediaId);
          return <div key={effect.id} className="flex items-center justify-between rounded bg-white/5 px-2 py-1 text-xs"><span>{effect.type} · {media?.fileName ?? effect.targetMediaId} · {effect.intensity.toFixed(2)}</span><button className="text-red-300 hover:text-red-200" onClick={() => removeEffect(effect.id)}>Remove</button></div>;
        })}</div>}
      </section>

      <section className="space-y-2 rounded border border-white/10 p-3">
        <h3 className="font-semibold">Project JSON</h3>
        <button className={buttonClass} onClick={() => downloadProjectDocument(project)}>Export project</button>
        <label className={`${buttonClass} ml-2 inline-block cursor-pointer`}>Import project<input className="hidden" type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && importProject(event.target.files[0])} /></label>
      </section>

      <section className="space-y-2 rounded border border-white/10 p-3">
        <h3 className="font-semibold">Remotion final render</h3>
        <input className={fieldClass} type="password" value={apiToken} onChange={(event) => setApiToken(event.target.value)} placeholder="CLIPJS_AGENT_TOKEN (production)" />
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} onClick={approveRelease} disabled={rendering}>Approve exact final cut</button>
          <button className={buttonClass} onClick={renderProject} disabled={rendering || project.workflow.releaseApproval.status !== 'approved'}>{rendering ? 'Rendering…' : renderRetryRequired ? 'Retry render explicitly' : 'Render release-approved project'}</button>
        </div>
        {renderDownloadUrl && <a className={`${buttonClass} inline-block`} href={renderDownloadUrl} download>Download rendered MP4</a>}
      </section>
    </div>
  );
}
