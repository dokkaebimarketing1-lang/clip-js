"use client";
import { use, useEffect, useRef, useState } from "react";
import { getFile, storeProject, useAppDispatch, useAppSelector } from "../../../store";
import { getProject } from "../../../store";
import { setCurrentProject, updateProject } from "../../../store/slices/projectsSlice";
import { rehydrate } from '../../../store/slices/projectSlice';
import AddText from '../../../components/editor/AssetsPanel/tools-section/AddText';
import AddMedia from '../../../components/editor/AssetsPanel/AddButtons/UploadMedia';
import MediaList from '../../../components/editor/AssetsPanel/tools-section/MediaList';
import { useRouter } from 'next/navigation';
import HomeButton from "../../../components/editor/AssetsPanel/SidebarButtons/HomeButton";

import MediaProperties from "../../../components/editor/PropertiesSection/MediaProperties";
import TextProperties from "../../../components/editor/PropertiesSection/TextProperties";
import { Timeline } from "../../../components/editor/timeline/Timline";
import { MediaFile } from "@/app/types";

import Image from "next/image";
import ProjectName from "../../../components/editor/player/ProjectName";
import WorkflowPanel from "@/app/components/editor/workflow/WorkflowPanel";
import VlogComposerCompact from "@/app/components/editor/workflow/VlogComposerCompact";
import PipelineCanvas from "@/app/components/editor/workflow/PipelineCanvas";
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
    const [leftTab, setLeftTab] = useState<'media' | 'text' | 'vlog'>('media');
    const [rightTab, setRightTab] = useState<'workflow' | 'props'>('workflow');

    const router = useRouter();
    const { activeElement } = projectState;
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
            <div className="flex min-h-0 flex-1 overflow-hidden">
                {/* 좌측 아이콘 레일 */}
                <div className="relative z-50 flex w-[64px] shrink-0 flex-col items-center gap-2 border-r border-gray-800 bg-neutral-950 p-3">
                    <HomeButton />
                    <button
                        aria-label="소스"
                        title="소스"
                        onClick={() => setLeftTab('media')}
                        className={`flex h-12 w-full items-center justify-center rounded-lg border text-xs font-bold transition ${leftTab === 'media' ? 'border-fuchsia-500 bg-fuchsia-500/15 text-fuchsia-300' : 'border-white/10 text-gray-300 hover:bg-white/10'}`}
                    >미디어</button>
                    <button
                        aria-label="텍스트"
                        title="텍스트"
                        onClick={() => setLeftTab('text')}
                        className={`flex h-12 w-full items-center justify-center rounded-lg border text-xs font-bold transition ${leftTab === 'text' ? 'border-fuchsia-500 bg-fuchsia-500/15 text-fuchsia-300' : 'border-white/10 text-gray-300 hover:bg-white/10'}`}
                    >텍스트</button>
                    <button
                        aria-label="VLOG"
                        title="VLOG AI 감독"
                        onClick={() => setLeftTab('vlog')}
                        className={`flex h-12 w-full items-center justify-center rounded-lg border text-xs font-bold transition ${leftTab === 'vlog' ? 'border-fuchsia-500 bg-fuchsia-500/15 text-fuchsia-300' : 'border-white/10 text-gray-300 hover:bg-white/10'}`}
                    >VLOG</button>
                </div>

                {/* 왼쪽 소스 패널 (상시 노출) */}
                <div className="relative z-40 min-h-0 w-[320px] shrink-0 overflow-y-auto border-r border-gray-800 bg-neutral-900 p-4">
                    {leftTab === 'media' && (
                        <div>
                            <h2 className="mb-3 text-sm font-semibold text-gray-200">미디어 소스</h2>
                            <AddMedia />
                            <div className="mt-4"><MediaList /></div>
                        </div>
                    )}
                    {leftTab === 'text' && (
                        <div>
                            <h2 className="mb-3 text-sm font-semibold text-gray-200">텍스트</h2>
                            <AddText />
                        </div>
                    )}
                    {leftTab === 'vlog' && (
                        <div>
                            <h2 className="mb-3 text-sm font-semibold text-gray-200">VLOG AI 감독</h2>
                            <p className="mb-3 text-xs text-gray-400">한 문장으로 8단계 영상 파이프라인을 자동 구성합니다. 결과는 오른쪽 설정창에서 확인하세요.</p>
                            <VlogComposerCompact />
                        </div>
                    )}
                </div>

                {/* 중앙 미리보기 + 타임라인 */}
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <PipelineCanvas
                        interviewBrief={projectState.workflow.interviewBrief}
                        characterSheet={projectState.workflow.characterSheet}
                        storyboard={projectState.workflow.storyboard}
                    />
                </div>

                {/* 오른쪽 설정창 (상시 노출) */}
                <div className="flex min-h-0 w-[400px] shrink-0 flex-col border-l border-gray-800 bg-neutral-900">
                    <div className="flex shrink-0 border-b border-gray-800">
                        <button
                            onClick={() => setRightTab('workflow')}
                            className={`flex-1 px-3 py-2 text-xs font-semibold transition ${rightTab === 'workflow' ? 'border-b-2 border-fuchsia-500 text-fuchsia-300' : 'text-gray-400 hover:text-gray-200'}`}
                        >워크플로우</button>
                        <button
                            onClick={() => setRightTab('props')}
                            className={`flex-1 px-3 py-2 text-xs font-semibold transition ${rightTab === 'props' ? 'border-b-2 border-fuchsia-500 text-fuchsia-300' : 'text-gray-400 hover:text-gray-200'}`}
                        >속성</button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-4">
                        {rightTab === 'workflow' ? (
                            <WorkflowPanel />
                        ) : (
                            <div className="space-y-4">
                                {activeElement === 'media' && (
                                    <div>
                                        <h2 className="mb-3 text-sm font-semibold text-gray-200">미디어 속성</h2>
                                        <MediaProperties />
                                    </div>
                                )}
                                {activeElement === 'text' && (
                                    <div>
                                        <h2 className="mb-3 text-sm font-semibold text-gray-200">텍스트 속성</h2>
                                        <TextProperties />
                                    </div>
                                )}
                                {!activeElement && (
                                    <p className="text-xs text-gray-500">타임라인에서 미디어나 텍스트를 선택하면 속성이 표시됩니다.</p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {/* Timeline at bottom */}
            <div className="flex h-12 shrink-0 flex-row items-stretch border-t border-gray-800 bg-darkSurfacePrimary">
                <div className="flex flex-col items-center justify-center border-r border-gray-800">
                    <div className="relative h-9 w-9">
                        <div className="flex h-full items-center justify-center gap-1 p-1.5">
                            <Image alt="Video" className="invert h-auto w-auto max-w-[18px] max-h-[18px]" height={18} width={18} src="https://www.svgrepo.com/show/532727/video.svg" />
                        </div>
                    </div>
                    <div className="relative h-9 w-9">
                        <div className="flex h-full items-center justify-center gap-1 p-1.5">
                            <Image alt="Music" className="invert h-auto w-auto max-w-[18px] max-h-[18px]" height={18} width={18} src="https://www.svgrepo.com/show/532708/music.svg" />
                        </div>
                    </div>
                    <div className="relative h-9 w-9">
                        <div className="flex h-full items-center justify-center gap-1 p-1.5">
                            <Image alt="Image" className="invert h-auto w-auto max-w-[18px] max-h-[18px]" height={18} width={18} src="https://www.svgrepo.com/show/535454/image.svg" />
                        </div>
                    </div>
                    <div className="relative h-9 w-9">
                        <div className="flex h-full items-center justify-center gap-1 p-1.5">
                            <Image alt="Text" className="invert h-auto w-auto max-w-[18px] max-h-[18px]" height={18} width={18} src="https://www.svgrepo.com/show/535686/text.svg" />
                        </div>
                    </div>
                </div>
                <Timeline />
            </div>
        </div >
    );
}
