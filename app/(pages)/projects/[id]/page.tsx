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
import {MockMediaList, MockPreviewPlayer} from '@/app/components/editor/workflow/MockMediaWorkspace';
import {deriveGenerationCtaState, type GenerationCtaTarget} from "@/app/lib/workflow/generation-cta";
import {getProjectWorkspaceLayout, PROJECT_WORKSPACES, type ProjectWorkspaceId} from '@/app/lib/editor/project-workspace';
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
    const [saveStatus, setSaveStatus] = useState<ProjectSaveStatus>({state: 'saved', savedRevision: 0, pendingRevision: 0});
    const [leftTab, setLeftTab] = useState<'media' | 'text'>('media');
    const [rightTab, setRightTab] = useState<'stage' | 'advanced' | 'props'>('stage');
    const [centerTab, setCenterTab] = useState<'pipeline' | 'preview'>('preview');
    const [workspace, setWorkspace] = useState<ProjectWorkspaceId>('interview');
    const [hasSubmittedGeneration, setHasSubmittedGeneration] = useState(false);

    useEffect(() => {
        const handleGenerationStatus = (event: Event) => {
            const detail = (event as CustomEvent<{hasSubmittedGeneration?: boolean}>).detail;
            setHasSubmittedGeneration(Boolean(detail?.hasSubmittedGeneration));
        };
        window.addEventListener('clipjs:generation-status', handleGenerationStatus);
        return () => window.removeEventListener('clipjs:generation-status', handleGenerationStatus);
    }, []);

    const generationCta = deriveGenerationCtaState({
        hasStoryboard: Boolean(projectState.workflow.storyboard),
        creativeApproved: projectState.workflow.creativeApproval.status === 'approved',
        generationApproved: projectState.workflow.generationApproval.status === 'approved',
        hasSubmittedGeneration,
    });

    const openGenerationGate = (target: GenerationCtaTarget) => {
        setWorkspace('generation');
        setCenterTab('pipeline');
        setRightTab('advanced');
        window.setTimeout(() => {
            document.getElementById(`generation-${target}`)?.scrollIntoView({behavior: 'smooth', block: 'start'});
        }, 0);
    };

    const router = useRouter();
    const searchParams = useSearchParams();
    const sampleMode = searchParams.get('sample') === '1';
    const { activeElement } = projectState;
    const workspaceLayout = getProjectWorkspaceLayout(workspace);
    const showMockMedia = sampleMode && projectState.mediaFiles.length === 0;
    const enableSampleMode = () => router.replace(`/projects/${id}?sample=1`);

    useEffect(() => {
        let cancelled = false;
        const objectUrls: string[] = [];
        const loadProject = async () => {
            setIsLoading(true);
            setLoadError(null);
            try {
                const project = await getProject(id);
                if (!project) {
                    router.replace('/404');
                    return;
                }
                const mediaFiles = await Promise.all(project.mediaFiles.map(async (media: MediaFile) => {
                    if (media.source?.kind === 'generated' || media.source?.kind === 'managed') return media;
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
            } catch (error) {
                console.error('Failed to load project:', error);
                if (!cancelled) setLoadError('프로젝트 저장소를 읽지 못했습니다. 데이터 보호를 위해 편집기를 열지 않았습니다.');
            } finally {
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
        if (!projectState || projectState.id !== currentProjectId || isLoading) return;
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
    }, [projectState, currentProjectId, isLoading, dispatch]);

    useEffect(() => {
        const flushProject = (rawEvent: Event) => {
            const event = rawEvent as CustomEvent<{resolve: (revision: number) => void; reject: (error: unknown) => void}>;
            if (autosaveTimeoutRef.current !== null) {
                window.clearTimeout(autosaveTimeoutRef.current);
                autosaveTimeoutRef.current = null;
            }
            const coordinator = saveCoordinatorRef.current;
            if (!coordinator) return event.detail.reject(new Error('Project save coordinator is unavailable.'));
            const status = coordinator.getStatus();
            const operation = status.state === 'error'
                ? coordinator.retry()
                : status.state === 'saved' ? coordinator.flush() : coordinator.saveLatest();
            void operation.then((ack) => event.detail.resolve(ack.revision)).catch(event.detail.reject);
        };
        window.addEventListener('clipjs:flush-project', flushProject);
        return () => window.removeEventListener('clipjs:flush-project', flushProject);
    }, []);

    useEffect(() => {
        const blockUnsafeExit = (event: BeforeUnloadEvent) => {
            if (!['dirty', 'saving', 'error'].includes(saveStatus.state)) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', blockUnsafeExit);
        return () => window.removeEventListener('beforeunload', blockUnsafeExit);
    }, [saveStatus.state]);

    useEffect(() => {
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
    }, [saveStatus.state]);

    useEffect(() => {
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
    }, [saveStatus.state]);


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
        <div className="flex flex-col h-screen select-none">
            {saveStatus.state === 'error' && (
                <div role="alert" className="z-[100] flex items-center justify-between gap-4 border-b border-red-500 bg-red-950 px-4 py-2 text-sm text-white">
                    <span>자동 저장 실패: {saveStatus.error ?? '프로젝트를 저장하지 못했습니다.'} 편집 내용은 아직 이 브라우저에만 있습니다.</span>
                    <button
                        type="button"
                        className="rounded bg-white px-3 py-1 font-semibold text-black"
                        onClick={() => void saveCoordinatorRef.current?.retry().catch(() => undefined)}
                    >저장 다시 시도</button>
                </div>
            )}
            {(saveStatus.state === 'dirty' || saveStatus.state === 'saving') && (
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
                            <p className="mt-4 text-white text-lg">Loading project...</p>
                        </div>
                    </div>
                ) : null
            }
            {/* 상단바: 로고/프로젝트명 + CTA + 저장상태 */}
            <header className="flex h-12 shrink-0 items-center gap-3 border-b border-gray-800 bg-neutral-950 px-4">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-black tracking-tight text-fuchsia-400">ClipJS</span>
                    <span className="h-4 w-px bg-gray-700" />
                    <ProjectName />
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <span className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] ${saveStatus.state === 'saved' ? 'text-emerald-400' : 'text-amber-400'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${saveStatus.state === 'saved' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                        {saveStatus.state === 'saved' ? '저장됨' : saveStatus.state === 'saving' ? '저장 중…' : '저장 대기'}
                    </span>
                    {projectState.workflow.storyboard ? <button
                        type="button"
                        aria-label="기획 데이터 승인 검토"
                        className="rounded-lg bg-gradient-to-r from-fuchsia-600 to-purple-600 px-3 py-1.5 text-xs font-bold text-white shadow transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300"
                        onClick={() => openGenerationGate(generationCta.target)}
                    >기획 데이터 검토</button> : null}
                </div>
            </header>

            <div className="flex min-h-0 flex-1 overflow-hidden">
                {/* 프로젝트 제작 단계 내비게이션 */}
                <nav aria-label="프로젝트 제작 단계" className="relative z-50 flex w-[132px] shrink-0 flex-col border-r border-gray-800 bg-neutral-950 p-2">
                    <div className="mb-2 [&_a]:h-10 [&_a]:w-full [&_a]:flex-row [&_a]:gap-2 [&_a]:px-2 [&_img]:max-h-[16px] [&_img]:max-w-[16px] [&_span]:text-[10px]"><HomeButton /></div>
                    <div className="mb-2 border-t border-white/10 pt-2 text-[9px] font-bold uppercase tracking-[0.18em] text-gray-600">Production</div>
                    <div className="space-y-1">
                        {PROJECT_WORKSPACES.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                aria-current={workspace === item.id ? 'page' : undefined}
                                onClick={() => setWorkspace(item.id)}
                                className={`group flex w-full items-center gap-2 rounded-lg border px-2 py-2.5 text-left transition ${workspace === item.id ? 'border-fuchsia-500/60 bg-fuchsia-500/15 text-white shadow-[inset_3px_0_0_#d946ef]' : 'border-transparent text-gray-400 hover:border-white/10 hover:bg-white/5 hover:text-gray-200'}`}
                            >
                                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[9px] font-black ${workspace === item.id ? 'bg-fuchsia-500 text-white' : 'bg-white/5 text-gray-500 group-hover:text-gray-300'}`}>{item.step}</span>
                                <span className="whitespace-nowrap text-[11px] font-bold leading-tight">{item.label}</span>
                            </button>
                        ))}
                    </div>
                </nav>

                {/* 왼쪽 소스 패널 (상시 노출) */}
                {workspaceLayout.showSources && <div className="relative z-40 min-h-0 w-[260px] shrink-0 overflow-y-auto border-r border-gray-800 bg-neutral-900 p-3">
                    <div className="mb-3 flex gap-1 rounded-lg bg-black/30 p-1">
                        <button type="button" onClick={() => setLeftTab('media')} className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-bold ${leftTab === 'media' ? 'bg-fuchsia-500/20 text-fuchsia-300' : 'text-gray-500'}`}>미디어</button>
                        <button type="button" onClick={() => setLeftTab('text')} className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-bold ${leftTab === 'text' ? 'bg-fuchsia-500/20 text-fuchsia-300' : 'text-gray-500'}`}>텍스트</button>
                    </div>
                    {leftTab === 'media' && (
                        <div>
                            <h2 className="mb-3 text-sm font-semibold text-gray-200">미디어 소스</h2>
                            <AddMedia />
                            <div className="mt-4">{showMockMedia ? <MockMediaList /> : <MediaList />}</div>
                        </div>
                    )}
                    {leftTab === 'text' && (
                        <div>
                            <h2 className="mb-3 text-sm font-semibold text-gray-200">텍스트</h2>
                            <AddText />
                        </div>
                    )}

                </div>}

                {/* 중앙: 단계별 워크스페이스 + 편집 타임라인 */}
                <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    {workspace === 'edit' && <div className="flex h-9 shrink-0 items-center gap-1 border-b border-white/10 bg-neutral-950 px-2">
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
                                storyboard={projectState.workflow.storyboard}
                                sampleMode={sampleMode}
                                onEnableSample={enableSampleMode}
                                onOpenEdit={() => setWorkspace('edit')}
                            />
                        ) : centerTab === 'preview' ? (
                            <div className="flex h-full items-center justify-center overflow-hidden bg-black">
                                {showMockMedia ? <MockPreviewPlayer /> : <PreviewPlayer />}
                            </div>
                        ) : (
                            <PipelineCanvas
                                interviewBrief={projectState.workflow.interviewBrief}
                                characterSheet={projectState.workflow.characterSheet}
                                storyboard={projectState.workflow.storyboard}
                            />
                        )}
                    </div>
                    {workspaceLayout.showTimeline && <section aria-label="타임라인 편집기" className="h-[210px] shrink-0 overflow-y-auto border-t border-gray-700 bg-[#17161a] px-2 pb-2">
                        <Timeline />
                    </section>}
                </main>

                {/* 현재 단계 정보. 내부 운영 도구는 고급 탭으로 격리한다. */}
                <div className="flex min-h-0 w-[320px] shrink-0 flex-col border-l border-gray-800 bg-neutral-900">
                    <div className="flex shrink-0 border-b border-gray-800">
                        <button
                            type="button"
                            onClick={() => setRightTab('stage')}
                            className={`flex-1 px-3 py-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fuchsia-400 ${rightTab === 'stage' ? 'border-b-2 border-fuchsia-500 text-fuchsia-300' : 'text-gray-400 hover:text-gray-200'}`}
                        >단계 정보</button>
                        <button
                            type="button"
                            onClick={() => setRightTab('advanced')}
                            className={`flex-1 px-3 py-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fuchsia-400 ${rightTab === 'advanced' ? 'border-b-2 border-fuchsia-500 text-fuchsia-300' : 'text-gray-400 hover:text-gray-200'}`}
                        >고급</button>
                        {workspace === 'edit' ? <button
                            type="button"
                            onClick={() => setRightTab('props')}
                            className={`flex-1 px-3 py-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fuchsia-400 ${rightTab === 'props' ? 'border-b-2 border-fuchsia-500 text-fuchsia-300' : 'text-gray-400 hover:text-gray-200'}`}
                        >속성</button> : null}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-4">
                        {rightTab === 'stage' ? (
                            <StageInspector
                                workspace={workspace}
                                workflow={projectState.workflow}
                                mediaCount={projectState.mediaFiles.length}
                                sampleMode={sampleMode}
                                onOpenAdvanced={() => setRightTab('advanced')}
                            />
                        ) : rightTab === 'advanced' ? (
                            <div><div className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4"><p className="text-sm font-black text-amber-200">고급 운영 콘솔</p><p className="mt-2 text-xs leading-5 text-amber-100/60">내부 8단계, 승인 해시, 생성 공급자와 복구 도구입니다. 일반 제작 흐름에서는 단계 정보 탭을 사용하세요.</p></div><WorkflowPanel /></div>
                        ) : (
                            <div className="space-y-4">
                                {activeElement === 'media' && <div><h2 className="mb-3 text-sm font-semibold text-gray-200">미디어 속성</h2><MediaProperties /></div>}
                                {activeElement === 'text' && <div><h2 className="mb-3 text-sm font-semibold text-gray-200">텍스트 속성</h2><TextProperties /></div>}
                                {!activeElement && <p className="text-sm leading-6 text-gray-500">타임라인에서 미디어나 텍스트를 선택하면 속성이 표시됩니다.</p>}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
