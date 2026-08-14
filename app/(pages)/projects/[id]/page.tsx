"use client";
import { use, useEffect, useRef, useState } from "react";
import { getFile, storeProject, useAppDispatch, useAppSelector } from "../../../store";
import { getProject } from "../../../store";
import { setCurrentProject, updateProject } from "../../../store/slices/projectsSlice";
import { rehydrate } from '../../../store/slices/projectSlice';
import AddText from '../../../components/editor/AssetsPanel/tools-section/AddText';
import AddMedia from '../../../components/editor/AssetsPanel/AddButtons/UploadMedia';
import MediaList from '../../../components/editor/AssetsPanel/tools-section/MediaList';
import { useRouter, useSearchParams } from 'next/navigation';
import HomeButton from "../../../components/editor/AssetsPanel/SidebarButtons/HomeButton";

import MediaProperties from "../../../components/editor/PropertiesSection/MediaProperties";
import TextProperties from "../../../components/editor/PropertiesSection/TextProperties";
import { Timeline } from "../../../components/editor/timeline/Timline";
import { PreviewPlayer } from "../../../components/editor/player/remotion/Player";
import { MediaFile } from "@/app/types";

import ProjectName from "../../../components/editor/player/ProjectName";
import WorkflowPanel from "@/app/components/editor/workflow/WorkflowPanel";
import PipelineCanvas from "@/app/components/editor/workflow/PipelineCanvas";
import StageWorkspace from "@/app/components/editor/workflow/StageWorkspace";
import StageInspector from "@/app/components/editor/workflow/StageInspector";
import EditFlowGate from "@/app/components/editor/workflow/EditFlowGate";
import {MockMediaList, MockPreviewPlayer} from '@/app/components/editor/workflow/MockMediaWorkspace';
import {deriveGenerationCtaState, type GenerationCtaTarget} from "@/app/lib/workflow/generation-cta";
import {deriveStageStepStates, type StageStepState} from '@/app/lib/editor/stage-status';
import {getInitialProjectWorkspace, getProjectWorkspaceLayout, PROJECT_WORKSPACES, type ProjectWorkspaceId} from '@/app/lib/editor/project-workspace';
import {
    ProjectSaveCoordinator,
    type ProjectSaveStatus,
} from '@/app/lib/project/project-save-coordinator';
import type {ProjectState} from '@/app/types';
export default function Project({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const dispatch = useAppDispatch();
    const projectState = useAppSelector((state) => state.projectState);
    const currentProjectId = useAppSelector((state) => state.projects.currentProjectId);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const saveCoordinatorRef = useRef<ProjectSaveCoordinator<ProjectState> | null>(null);
    const pendingSaveRef = useRef<ProjectState | null>(null);
    const autosaveTimeoutRef = useRef<number | null>(null);
    const editorUrlRef = useRef('');
    const mobileSourcesTriggerRef = useRef<HTMLButtonElement | null>(null);
    const mobileSourcesCloseRef = useRef<HTMLButtonElement | null>(null);
    const [saveStatus, setSaveStatus] = useState<ProjectSaveStatus>({state: 'saved', savedRevision: 0, pendingRevision: 0});
    const [leftTab, setLeftTab] = useState<'media' | 'text'>('media');
    const [mobileSourcesOpen, setMobileSourcesOpen] = useState(false);
    const [rightTab, setRightTab] = useState<'stage' | 'advanced' | 'props'>('stage');
    const [centerTab, setCenterTab] = useState<'pipeline' | 'preview'>('preview');
    const [workspace, setWorkspace] = useState<ProjectWorkspaceId>('interview');
    const [hasSubmittedGeneration, setHasSubmittedGeneration] = useState(false);
    const [generationGateResult, setGenerationGateResult] = useState<{
        project: ProjectState;
        submitted: boolean;
        states: Record<string, StageStepState>;
    } | null>(null);
    const router = useRouter();
    const searchParams = useSearchParams();
    const sampleMode = searchParams.get('sample') === '1';
    const effectiveRightTab = sampleMode ? 'stage' : rightTab;

    useEffect(() => {
        if (!mobileSourcesOpen) return;
        const focusFrame = window.requestAnimationFrame(() => mobileSourcesCloseRef.current?.focus());
        const trigger = mobileSourcesTriggerRef.current;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setMobileSourcesOpen(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            window.removeEventListener('keydown', handleKeyDown);
            window.requestAnimationFrame(() => trigger?.focus());
        };
    }, [mobileSourcesOpen]);

    useEffect(() => {
        const handleGenerationStatus = (event: Event) => {
            const detail = (event as CustomEvent<{hasSubmittedGeneration?: boolean}>).detail;
            setHasSubmittedGeneration(Boolean(detail?.hasSubmittedGeneration));
        };
        window.addEventListener('clipjs:generation-status', handleGenerationStatus);
        return () => window.removeEventListener('clipjs:generation-status', handleGenerationStatus);
    }, []);

    useEffect(() => {
        let current = true;
        void deriveStageStepStates({workspace: 'generation', project: projectState, hasSubmittedGeneration}).then((states) => {
            if (current) setGenerationGateResult({project: projectState, submitted: hasSubmittedGeneration, states});
        });
        return () => { current = false; };
    }, [hasSubmittedGeneration, projectState]);
    const generationGateStates = generationGateResult?.project === projectState
        && generationGateResult.submitted === hasSubmittedGeneration
        ? generationGateResult.states
        : null;
    const canEnterStoryboardFlow = generationGateStates?.['planning-approval'] === 'complete'
        && generationGateStates['character-lock'] === 'complete';
    const generationCta = !sampleMode && generationGateStates && canEnterStoryboardFlow ? deriveGenerationCtaState({
        hasStoryboard: generationGateStates.storyboard === 'complete',
        creativeApproved: generationGateStates['creative-approval'] === 'complete',
        generationApproved: generationGateStates['generation-approval'] === 'complete',
        hasSubmittedGeneration: generationGateStates['generation-job'] === 'complete',
    }) : null;

    const navigateWorkspace = (next: ProjectWorkspaceId) => {
        setMobileSourcesOpen(false);
        setWorkspace(next);
    };

    const openGenerationGate = (target: GenerationCtaTarget) => {
        if (sampleMode) {
            setRightTab('stage');
            return;
        }
        navigateWorkspace(target === 'compose' || target === 'creative' ? 'storyboard' : 'generation');
        setCenterTab('pipeline');
        if (target !== 'compose' && target !== 'creative') setRightTab('advanced');
        window.setTimeout(() => {
            document.getElementById(`generation-${target}`)?.scrollIntoView({behavior: 'smooth', block: 'start'});
        }, 0);
    };

    const { activeElement } = projectState;
    const workspaceLayout = getProjectWorkspaceLayout(workspace);
    const showMockMedia = sampleMode;
    const enableSampleMode = () => {
        setRightTab('stage');
        router.replace(`/projects/${id}?sample=1`);
    };

    useEffect(() => {
        let cancelled = false;
        const objectUrls: string[] = [];
        const loadProject = async () => {
            setIsLoading(true);
            setLoadError(null);
            let loadTimeout: number | undefined;
            try {
                const project = await Promise.race([
                    getProject(id),
                    new Promise<never>((_, reject) => {
                        loadTimeout = window.setTimeout(() => reject(new Error('PROJECT_LOAD_TIMEOUT')), 12_000);
                    }),
                ]);
                if (!project) {
                    router.replace('/404');
                    return;
                }
                const mediaFiles = await Promise.all(project.mediaFiles.map(async (media: MediaFile) => {
                    if (media.source?.kind === 'generated' || media.source?.kind === 'managed') {
                        const assetId = media.source.kind === 'generated' ? media.source.generatedAssetId : media.source.assetId;
                        try {
                            const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/assets/${encodeURIComponent(assetId)}/ui-capability`, {method: 'POST'});
                            const payload = await response.json() as {url?: string};
                            if (!response.ok || !payload.url) return media;
                            return {...media, src: payload.url, remoteUrl: payload.url};
                        } catch {
                            return media;
                        }
                    }
                    const fileId = media.source?.kind === 'indexeddb' ? media.source.fileId : media.fileId;
                    if (!fileId) return media;
                    const file = await getFile(fileId);
                    if (!file) return {...media, src: media.remoteUrl};
                    const src = URL.createObjectURL(file);
                    objectUrls.push(src);
                    return {...media, src};
                }));
                if (cancelled) {
                    objectUrls.forEach((url) => URL.revokeObjectURL(url));
                    objectUrls.length = 0;
                    return;
                }
                const loadedProject = {...project, mediaFiles};
                saveCoordinatorRef.current = new ProjectSaveCoordinator<ProjectState>({
                    initialRevision: project.revision,
                    onStatus: setSaveStatus,
                    persist: async ({snapshot, expectedRevision, revision}) => {
                        const candidate = {...snapshot, projectSchemaVersion: 3 as const, revision};
                        await storeProject(candidate, {expectedRevision});
                        dispatch(updateProject(candidate));
                    },
                });
                dispatch(setCurrentProject(id));
                dispatch(rehydrate(loadedProject));
                setWorkspace(getInitialProjectWorkspace({
                    planningApproved: loadedProject.workflow.planningStatus === 'approved',
                    hasStoryboard: Boolean(loadedProject.workflow.storyboard),
                }));
            } catch (error) {
                console.error('Failed to load project:', error);
                if (!cancelled) setLoadError(error instanceof Error && error.message === 'PROJECT_LOAD_TIMEOUT'
                    ? '프로젝트 저장소 응답이 12초 안에 끝나지 않았습니다. 다른 ClipJS 탭을 닫고 다시 시도해 주세요.'
                    : '프로젝트 저장소를 읽지 못했습니다. 데이터 보호를 위해 편집기를 열지 않았습니다.');
            } finally {
                if (loadTimeout !== undefined) window.clearTimeout(loadTimeout);
                if (!cancelled) setIsLoading(false);
            }
        };
        void loadProject();
        return () => {
            cancelled = true;
            objectUrls.forEach((url) => URL.revokeObjectURL(url));
            objectUrls.length = 0;
        };
    }, [id, dispatch, router]);


    // Debounced autosave. Failures remain visible and retryable via ProjectSaveCoordinator.
    useEffect(() => {
        if (sampleMode || !projectState || projectState.id !== currentProjectId || isLoading) return;
        let coordinator = saveCoordinatorRef.current;
        if (!coordinator) return;
        if (projectState.revision > coordinator.getStatus().savedRevision) {
            coordinator = new ProjectSaveCoordinator<ProjectState>({
                initialRevision: projectState.revision,
                onStatus: setSaveStatus,
                persist: async ({snapshot, expectedRevision, revision}) => {
                    const candidate = {...snapshot, projectSchemaVersion: 3 as const, revision};
                    await storeProject(candidate, {expectedRevision});
                    dispatch(updateProject(candidate));
                },
            });
            saveCoordinatorRef.current = coordinator;
            pendingSaveRef.current = null;
            return;
        }
        const activeCoordinator = coordinator;
        pendingSaveRef.current = structuredClone(projectState);
        activeCoordinator.markDirty(projectState);
        const timeout = window.setTimeout(() => {
            autosaveTimeoutRef.current = null;
            void activeCoordinator.saveLatest().catch(() => {
                // saveStatus carries the failure; avoid an unhandled rejection without declaring success.
            });
        }, 300);
        autosaveTimeoutRef.current = timeout;
        return () => {
            window.clearTimeout(timeout);
            if (autosaveTimeoutRef.current === timeout) autosaveTimeoutRef.current = null;
        };
    }, [projectState, currentProjectId, isLoading, dispatch, sampleMode]);

    useEffect(() => {
        const flushProject = (rawEvent: Event) => {
            const event = rawEvent as CustomEvent<{
                resolve: (revision: number) => void;
                reject: (error: unknown) => void;
                snapshot?: ProjectState;
            }>;
            if (sampleMode) return event.detail.reject(new Error('SAMPLE_READ_ONLY'));
            if (autosaveTimeoutRef.current !== null) {
                window.clearTimeout(autosaveTimeoutRef.current);
                autosaveTimeoutRef.current = null;
            }
            const coordinator = saveCoordinatorRef.current;
            if (!coordinator) return event.detail.reject(new Error('Project save coordinator is unavailable.'));
            const status = coordinator.getStatus();
            let operation;
            if (event.detail.snapshot) {
                if (event.detail.snapshot.id !== currentProjectId) {
                    return event.detail.reject(new Error('Project snapshot does not belong to the active project.'));
                }
                if (status.state === 'error') {
                    coordinator.markDirty(event.detail.snapshot);
                    operation = coordinator.retry();
                } else {
                    operation = coordinator.saveNow(event.detail.snapshot);
                }
            } else {
                operation = status.state === 'error'
                    ? coordinator.retry()
                    : status.state === 'saved' ? coordinator.flush() : coordinator.saveLatest();
            }
            void operation.then((ack) => event.detail.resolve(ack.revision)).catch(event.detail.reject);
        };
        window.addEventListener('clipjs:flush-project', flushProject);
        return () => window.removeEventListener('clipjs:flush-project', flushProject);
    }, [currentProjectId, sampleMode]);

    useEffect(() => {
        if (sampleMode) return;
        const blockUnsafeExit = (event: BeforeUnloadEvent) => {
            if (!['dirty', 'saving', 'error'].includes(saveStatus.state)) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', blockUnsafeExit);
        return () => window.removeEventListener('beforeunload', blockUnsafeExit);
    }, [sampleMode, saveStatus.state]);

    useEffect(() => {
        if (sampleMode) return;
        const saveBeforeNavigation = (event: MouseEvent) => {
            if (!['dirty', 'saving', 'error'].includes(saveStatus.state)) return;
            const target = event.target;
            const anchor = target instanceof Element ? target.closest('a[href]') as HTMLAnchorElement | null : null;
            if (!anchor || anchor.href === window.location.href) return;
            event.preventDefault();
            event.stopPropagation();
            if (!window.confirm('저장되지 않은 변경 사항이 있습니다. 저장한 뒤 이동할까요?')) return;
            const coordinator = saveCoordinatorRef.current;
            const snapshot = pendingSaveRef.current;
            if (!coordinator) return;
            const save = saveStatus.state === 'error'
                ? coordinator.retry()
                : snapshot ? coordinator.saveNow(snapshot) : coordinator.flush();
            void save.then(() => window.location.assign(anchor.href)).catch(() => undefined);
        };
        document.addEventListener('click', saveBeforeNavigation, true);
        return () => document.removeEventListener('click', saveBeforeNavigation, true);
    }, [sampleMode, saveStatus.state]);

    useEffect(() => {
        if (sampleMode) return;
        if (!editorUrlRef.current) editorUrlRef.current = window.location.href;
        const onPopState = () => {
            if (saveStatus.state === 'saved') return;
            const destination = window.location.href;
            window.history.pushState({__clipjsSaveGuard: true}, '', editorUrlRef.current);
            if (!window.confirm('저장되지 않은 변경 사항을 저장한 뒤 이동할까요?')) return;
            window.setTimeout(() => {
                const coordinator = saveCoordinatorRef.current;
                const snapshot = pendingSaveRef.current;
                if (!coordinator || !snapshot) return;
                void coordinator.saveNow(snapshot)
                    .then(() => window.location.assign(destination))
                    .catch(() => undefined);
            }, 0);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [sampleMode, saveStatus.state]);


    if (loadError) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
                <div role="alert" className="max-w-lg rounded-xl border border-red-500/50 bg-red-950/30 p-6 text-center">
                    <h1 className="text-xl font-bold">프로젝트를 안전하게 열 수 없습니다</h1>
                    <p className="mt-3 text-sm text-white/80">{loadError}</p>
                    <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded bg-white px-4 py-2 font-semibold text-black">다시 시도</button>
                </div>
            </main>
        );
    }

    return (
        <div className="flex h-screen select-none flex-col overflow-hidden bg-[#090a0f] text-gray-100">
            {!sampleMode && saveStatus.state === 'error' && (
                <div role="alert" className="z-[100] flex items-center justify-between gap-4 border-b border-red-500 bg-red-950 px-4 py-2 text-sm text-white">
                    <span>자동 저장 실패: {saveStatus.error ?? '프로젝트를 저장하지 못했습니다.'} 편집 내용은 아직 이 브라우저에만 있습니다.</span>
                    <button
                        type="button"
                        className="rounded bg-white px-3 py-1 font-semibold text-black"
                        onClick={() => void saveCoordinatorRef.current?.retry().catch(() => undefined)}
                    >저장 다시 시도</button>
                </div>
            )}
            {!sampleMode && (saveStatus.state === 'dirty' || saveStatus.state === 'saving') && (
                <div role="status" className="absolute right-3 top-3 z-[90] rounded bg-black/80 px-3 py-1 text-xs text-white/80">
                    {saveStatus.state === 'saving' ? '저장 중…' : '저장 대기 중…'}
                </div>
            )}
            {/* Loading screen */}
            {
                isLoading ? (
                    <div className="fixed inset-0 flex items-center bg-black bg-opacity-50 justify-center z-50">
                        <div className="bg-black bg-opacity-70 p-6 rounded-lg flex flex-col items-center">
                            <div className="w-16 h-16 border-4 border-t-white border-r-white border-opacity-30 border-t-opacity-100 rounded-full animate-spin"></div>
                            <p className="mt-4 text-white text-lg">프로젝트를 불러오는 중...</p>
                        </div>
                    </div>
                ) : null
            }
            {/* 상단바: 로고/프로젝트명 + CTA + 저장상태 */}
            <header className="flex h-14 shrink-0 items-center gap-4 border-b border-white/[0.08] bg-[#0c0d12]/95 px-4 shadow-[0_1px_0_rgba(255,255,255,.02)] backdrop-blur-xl">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-600 text-xs font-black text-white shadow-[0_0_24px_rgba(217,70,239,.22)]">C</span>
                    <span className="hidden text-sm font-black tracking-[-0.03em] text-white sm:inline">ClipJS</span>
                    <span className="h-4 w-px shrink-0 bg-white/10" aria-hidden="true" />
                    <div className="min-w-0">{sampleMode ? <span className="block truncate text-sm font-black text-amber-200">샘플 프로젝트 · 읽기 전용</span> : <ProjectName />}</div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <span className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] ${sampleMode ? 'text-amber-200' : saveStatus.state === 'saved' ? 'text-emerald-400' : 'text-amber-400'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${sampleMode ? 'bg-amber-300' : saveStatus.state === 'saved' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                        {sampleMode ? '저장 안 함' : saveStatus.state === 'saved' ? '저장됨' : saveStatus.state === 'saving' ? '저장 중…' : '저장 대기'}
                    </span>
                    {!sampleMode && generationCta ? <button
                        type="button"
                        aria-label={generationCta.label}
                        className="rounded-lg bg-gradient-to-r from-fuchsia-600 to-purple-600 px-3 py-1.5 text-xs font-bold text-white shadow transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300"
                        onClick={() => openGenerationGate(generationCta.target)}
                    >{generationCta.label}</button> : null}
                </div>
            </header>

            <div className="relative flex min-h-0 flex-1 overflow-hidden">
                {/* 프로젝트 제작 단계 내비게이션 */}
                <nav aria-label="프로젝트 제작 단계" className="relative z-50 flex w-[76px] shrink-0 flex-col border-r border-white/[0.08] bg-[#0c0d12] p-2 lg:w-[164px] lg:p-3">
                    <div className="mb-3 [&_a]:h-10 [&_a]:w-full [&_a]:flex-row [&_a]:justify-center [&_a]:gap-2 [&_a]:px-2 [&_img]:max-h-[16px] [&_img]:max-w-[16px] [&_span]:hidden lg:[&_a]:justify-start lg:[&_span]:inline lg:[&_span]:text-[11px]"><HomeButton /></div>
                    <div className="mb-2 hidden border-t border-white/[0.08] pt-3 text-[9px] font-black uppercase tracking-[0.2em] text-gray-600 lg:block">제작 흐름</div>
                    <div className="space-y-1.5">
                        {PROJECT_WORKSPACES.map((item) => {
                            const planningLocked = !sampleMode && item.id !== 'interview' && projectState.workflow.planningStatus !== 'approved';
                            return (
                            <button
                                key={item.id}
                                type="button"
                                aria-current={workspace === item.id ? 'page' : undefined}
                                aria-label={`${item.step}단계 ${item.label}${planningLocked ? ' · 기획 확정 후 이용 가능' : ''}`}
                                disabled={planningLocked}
                                title={planningLocked ? 'AI 기획 초안을 먼저 검수하고 확정하세요.' : `${item.step}단계 ${item.label}`}
                                onClick={() => navigateWorkspace(item.id)}
                                className={`group flex w-full items-center justify-center gap-2 rounded-xl border px-2 py-2.5 text-left transition-[border-color,background-color,color,box-shadow] lg:justify-start ${workspace === item.id ? 'border-fuchsia-400/35 bg-fuchsia-400/[0.1] text-white shadow-[inset_3px_0_0_#d946ef]' : 'border-transparent text-gray-500 hover:border-white/10 hover:bg-white/[0.045] hover:text-gray-200'} disabled:cursor-not-allowed disabled:opacity-35`}
                            >
                                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-black ${workspace === item.id ? 'bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white shadow-[0_0_18px_rgba(217,70,239,.22)]' : 'bg-white/[0.055] text-gray-500 group-hover:text-gray-300'}`}>{item.step}</span>
                                <span className="hidden whitespace-nowrap text-[11px] font-bold leading-tight lg:inline">{item.label}</span>
                            </button>
                            );
                        })}
                    </div>
                </nav>

                {/* 왼쪽 소스 패널 (상시 노출) */}
                {workspaceLayout.showSources && <div id="mobile-edit-sources" className={`${mobileSourcesOpen ? 'absolute inset-y-0 left-[76px] flex' : 'hidden'} z-40 min-h-0 w-[260px] shrink-0 flex-col overflow-y-auto border-r border-gray-800 bg-neutral-900 p-3 md:static md:flex`}>
                    <div className="mb-3 flex gap-1 rounded-lg bg-black/30 p-1">
                        <button type="button" onClick={() => setLeftTab('media')} className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-bold ${leftTab === 'media' ? 'bg-fuchsia-500/20 text-fuchsia-300' : 'text-gray-500'}`}>미디어</button>
                        <button type="button" onClick={() => setLeftTab('text')} className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-bold ${leftTab === 'text' ? 'bg-fuchsia-500/20 text-fuchsia-300' : 'text-gray-500'}`}>텍스트</button>
                        <button ref={mobileSourcesCloseRef} type="button" aria-label="소스 패널 닫기" onClick={() => setMobileSourcesOpen(false)} className="rounded-md px-2 text-gray-400 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 md:hidden">×</button>
                    </div>
                    {leftTab === 'media' && (
                        <div>
                            <h2 className="mb-3 text-sm font-semibold text-gray-200">미디어 소스</h2>
                            {!sampleMode ? <AddMedia /> : <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.07] p-3 text-xs leading-5 text-amber-100">샘플 모드에서는 미디어를 추가하거나 변경할 수 없습니다.</p>}
                            <div className="mt-4">{showMockMedia ? <MockMediaList /> : <MediaList />}</div>
                        </div>
                    )}
                    {leftTab === 'text' && (
                        <div>
                            <h2 className="mb-3 text-sm font-semibold text-gray-200">텍스트</h2>
                            {!sampleMode ? <AddText /> : <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.07] p-3 text-xs leading-5 text-amber-100">샘플 모드에서는 텍스트를 추가하거나 변경할 수 없습니다.</p>}
                        </div>
                    )}

                </div>}

                {/* 중앙: 단계별 워크스페이스 + 편집 타임라인 */}
                <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    {workspace === 'edit' && <div className="flex h-9 shrink-0 items-center gap-1 border-b border-white/10 bg-neutral-950 px-2">
                        <button
                            ref={mobileSourcesTriggerRef}
                            type="button"
                            aria-expanded={mobileSourcesOpen}
                            aria-controls="mobile-edit-sources"
                            onClick={() => setMobileSourcesOpen(true)}
                            className="h-7 rounded-md border border-white/10 px-2 text-[10px] font-bold text-gray-300 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 md:hidden"
                        >소스</button>
                        <button
                            type="button"
                            onClick={() => setCenterTab('pipeline')}
                            className={`h-full px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fuchsia-400 ${centerTab === 'pipeline' ? 'border-b-2 border-fuchsia-500 text-fuchsia-300' : 'text-gray-400 hover:text-gray-200'}`}
                        >파이프라인</button>
                        <button
                            type="button"
                            onClick={() => setCenterTab('preview')}
                            className={`h-full px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fuchsia-400 ${centerTab === 'preview' ? 'border-b-2 border-fuchsia-500 text-fuchsia-300' : 'text-gray-400 hover:text-gray-200'}`}
                        >미리보기</button>
                        <span className="ml-auto pr-2 font-mono text-[10px] tabular-nums text-gray-500">00:00 / 00:{String(projectState.workflow.seedanceMaster.duration).padStart(2, '0')}</span>
                    </div>}
                    <div className="min-h-0 flex-1 overflow-hidden">
                        {workspace !== 'edit' ? (
                            <StageWorkspace
                                workspace={workspace}
                                interviewBrief={projectState.workflow.interviewBrief}
                                characterSheet={projectState.workflow.characterSheet}
                                characterSheets={projectState.workflow.characterSheets}
                                storyboard={projectState.workflow.storyboard}
                                sampleMode={sampleMode}
                                onEnableSample={enableSampleMode}
                                onOpenEdit={() => navigateWorkspace('edit')}
                                onNavigate={navigateWorkspace}
                            />
                        ) : centerTab === 'preview' ? (
                            <div className="flex h-full flex-col overflow-hidden bg-black">
                                <EditFlowGate project={projectState} sampleMode={sampleMode}/>
                                <div className="min-h-0 flex-1">{showMockMedia ? <MockPreviewPlayer /> : <PreviewPlayer />}</div>
                            </div>
                        ) : (
                            <div className="flex h-full flex-col overflow-hidden">
                                <EditFlowGate project={projectState} sampleMode={sampleMode}/>
                                <div className="min-h-0 flex-1"><PipelineCanvas
                                    interviewBrief={sampleMode ? undefined : projectState.workflow.interviewBrief}
                                    characterSheet={sampleMode ? undefined : projectState.workflow.characterSheet}
                                    storyboard={sampleMode ? undefined : projectState.workflow.storyboard}
                                    sampleMode={sampleMode}
                                /></div>
                            </div>
                        )}
                    </div>
                    {workspaceLayout.showTimeline && <section aria-label="타임라인 편집기" className="h-[210px] shrink-0 overflow-y-auto border-t border-gray-700 bg-[#17161a] px-2 pb-2">
                                            {sampleMode ? <div className="p-3">
                                                <div className="flex items-center justify-between text-xs text-gray-400"><span className="font-black text-amber-200">샘플 타임라인 · 읽기 전용</span><span>저장 안 함</span></div>
                                                <div className="mt-4 grid gap-2">
                                                    <div className="h-9 rounded-lg border border-fuchsia-400/20 bg-fuchsia-500/10 px-3 py-2 text-xs font-bold text-fuchsia-100">V1 · 샘플 영상 클립</div>
                                                    <div className="h-9 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-100">A1 · 샘플 오디오</div>
                                                    <div className="h-9 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-gray-400">T1 · 샘플 텍스트</div>
                                                </div>
                                            </div> : <Timeline />}
                                        </section>}
                </main>

                {/* 스토리보드는 자체 선택 컷 inspector를 사용한다. 다른 단계의 운영 도구는 고급 탭으로 격리한다. */}
                {workspace !== 'storyboard' ? <aside aria-label="단계 도구" className="hidden min-h-0 w-[286px] shrink-0 flex-col border-l border-white/[0.08] bg-[#0d0f15] lg:flex 2xl:w-[320px]">
                    <div className="flex shrink-0 border-b border-gray-800">
                        <button
                            type="button"
                            onClick={() => setRightTab('stage')}
                            className={`flex-1 px-3 py-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fuchsia-400 ${effectiveRightTab === 'stage' ? 'border-b-2 border-fuchsia-500 text-fuchsia-300' : 'text-gray-400 hover:text-gray-200'}`}
                        >단계 정보</button>
                        <button
                            type="button"
                            disabled={sampleMode}
                            onClick={() => setRightTab('advanced')}
                            className={`flex-1 px-3 py-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fuchsia-400 disabled:cursor-not-allowed disabled:text-gray-700 ${effectiveRightTab === 'advanced' ? 'border-b-2 border-fuchsia-500 text-fuchsia-300' : 'text-gray-400 hover:text-gray-200'}`}
                        >{sampleMode ? '실행 잠금' : workspace === 'generation' ? '생성 실행' : '고급'}</button>
                        {workspace === 'edit' ? <button
                            type="button"
                            disabled={sampleMode}
                            onClick={() => setRightTab('props')}
                            className={`flex-1 px-3 py-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fuchsia-400 disabled:cursor-not-allowed disabled:text-gray-700 ${rightTab === 'props' ? 'border-b-2 border-fuchsia-500 text-fuchsia-300' : 'text-gray-400 hover:text-gray-200'}`}
                        >속성</button> : null}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-4">
                        {effectiveRightTab === 'stage' ? (
                            <StageInspector
                                workspace={workspace}
                                project={projectState}
                                sampleMode={sampleMode}
                                hasSubmittedGeneration={hasSubmittedGeneration}
                                onOpenAdvanced={() => setRightTab('advanced')}
                            />
                        ) : effectiveRightTab === 'advanced' ? (
                            <div><div className={`mb-4 rounded-2xl border p-4 ${workspace === 'generation' ? 'border-fuchsia-400/25 bg-fuchsia-400/[0.07]' : 'border-amber-400/20 bg-amber-400/[0.06]'}`}><p className={`text-sm font-black ${workspace === 'generation' ? 'text-fuchsia-200' : 'text-amber-200'}`}>{workspace === 'generation' ? '생성 실행' : '고급 운영 콘솔'}</p><p className={`mt-2 text-xs leading-5 ${workspace === 'generation' ? 'text-fuchsia-100/60' : 'text-amber-100/60'}`}>{workspace === 'generation' ? '사양·비용 확인 → Generation 승인 → 유료 제출 → 작업 상태 확인 순서로 진행합니다. JSON·토큰·공급자 세부값은 아래 고급 항목입니다.' : '승인 해시, 생성 공급자와 복구 도구입니다. 일반 제작 흐름에서는 단계 정보 탭을 사용하세요.'}</p></div><WorkflowPanel /></div>
                        ) : (
                            <div className="space-y-4">
                                {activeElement === 'media' && <div><h2 className="mb-3 text-sm font-semibold text-gray-200">미디어 속성</h2><MediaProperties /></div>}
                                {activeElement === 'text' && <div><h2 className="mb-3 text-sm font-semibold text-gray-200">텍스트 속성</h2><TextProperties /></div>}
                                {!activeElement && <p className="text-sm leading-6 text-gray-500">타임라인에서 미디어나 텍스트를 선택하면 속성이 표시됩니다.</p>}
                            </div>
                        )}
                    </div>
                </aside> : null}
            </div>
        </div>
    );
}
