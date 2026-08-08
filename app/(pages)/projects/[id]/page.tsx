"use client";
import { use, useEffect, useRef, useState } from "react";
import { getFile, storeProject, useAppDispatch, useAppSelector } from "../../../store";
import { getProject } from "../../../store";
import { setCurrentProject, updateProject } from "../../../store/slices/projectsSlice";
import { rehydrate, setMediaFiles } from '../../../store/slices/projectSlice';
import { setActiveSection } from "../../../store/slices/projectSlice";
import AddText from '../../../components/editor/AssetsPanel/tools-section/AddText';
import AddMedia from '../../../components/editor/AssetsPanel/AddButtons/UploadMedia';
import MediaList from '../../../components/editor/AssetsPanel/tools-section/MediaList';
import { useRouter } from 'next/navigation';
import TextButton from "@/app/components/editor/AssetsPanel/SidebarButtons/TextButton";
import LibraryButton from "@/app/components/editor/AssetsPanel/SidebarButtons/LibraryButton";
import ExportButton from "@/app/components/editor/AssetsPanel/SidebarButtons/ExportButton";
import HomeButton from "@/app/components/editor/AssetsPanel/SidebarButtons/HomeButton";

import MediaProperties from "../../../components/editor/PropertiesSection/MediaProperties";
import TextProperties from "../../../components/editor/PropertiesSection/TextProperties";
import { Timeline } from "../../../components/editor/timeline/Timline";
import { PreviewPlayer } from "../../../components/editor/player/remotion/Player";
import { MediaFile } from "@/app/types";

import Image from "next/image";
import ProjectName from "../../../components/editor/player/ProjectName";
import WorkflowPanel from "@/app/components/editor/workflow/WorkflowPanel";
export default function Project({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const dispatch = useAppDispatch();
    const projectState = useAppSelector((state) => state.projectState);
    const currentProjectId = useAppSelector((state) => state.projects.currentProjectId);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const pendingSaveRef = useRef<typeof projectState | null>(null);
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

    const router = useRouter();
    const { activeSection, activeElement } = projectState;
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
                    const file = await getFile(media.fileId);
                    if (!file) return {...media, src: media.remoteUrl};
                    const src = URL.createObjectURL(file);
                    objectUrls.push(src);
                    return {...media, src};
                }));
                if (cancelled) return;
                dispatch(setCurrentProject(id));
                dispatch(rehydrate(project));
                dispatch(setMediaFiles(mediaFiles));
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
        };
    }, [id, dispatch, router]);


    // save
    useEffect(() => {
        if (!projectState || projectState.id !== currentProjectId) return;
        pendingSaveRef.current = projectState;
        const snapshot = structuredClone(projectState);
        const timeout = window.setTimeout(() => {
            saveQueueRef.current = saveQueueRef.current.catch(() => undefined).then(async () => {
                await storeProject(snapshot);
                if (pendingSaveRef.current === projectState) {
                    pendingSaveRef.current = null;
                }
                dispatch(updateProject(snapshot));
            }).catch(() => undefined);
        }, 300);
        return () => window.clearTimeout(timeout);
    }, [projectState, dispatch, currentProjectId]);

    useEffect(() => () => {
        const pending = pendingSaveRef.current;
        if (pending?.id === currentProjectId) {
            const snapshot = structuredClone(pending);
            saveQueueRef.current = saveQueueRef.current.catch(() => undefined).then(() => storeProject(snapshot).then(() => undefined)).catch(() => undefined);
        }
    }, [currentProjectId]);


    const handleFocus = (section: "media" | "text" | "workflow" | "export") => {
        dispatch(setActiveSection(section));
    };

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
                {/* Left Sidebar - Buttons */}
                <div className="relative z-50 flex-[0.1] min-w-[60px] max-w-[100px] border-r border-gray-700 bg-black overflow-y-auto p-4">
                    <div className="flex flex-col space-y-2">
                        <HomeButton />
                        <button
                            aria-label="Production workflow"
                            title="Production workflow"
                            onClick={() => handleFocus("workflow")}
                            className="flex h-12 w-full shrink-0 items-center justify-center rounded border border-white/10 text-xs font-bold hover:bg-white/10"
                        >WF</button>
                        <TextButton onClick={() => handleFocus("text")} />
                        <LibraryButton onClick={() => handleFocus("media")} />
                        <ExportButton onClick={() => handleFocus("workflow")} />
                        {/* TODO: add shortcuts guide but in a better way */}
                        {/* <ShortcutsButton onClick={() => handleFocus("export")} /> */}
                    </div>
                </div>

                {/* Add media and text */}
                <div className="relative z-40 min-h-0 w-[380px] min-w-[360px] shrink-0 overflow-y-auto border-r border-gray-800 bg-black p-4">
                    {activeSection === "media" && (
                        <div>
                            <h2 className="text-lg flex flex-row gap-2 items-center justify-center font-semibold mb-2">
                                <AddMedia />
                            </h2>
                            <MediaList />
                        </div>
                    )}
                    {activeSection === "text" && (
                        <div>
                            <AddText />
                        </div>
                    )}
                    {activeSection === "workflow" && (
                        <div>
                            <h2 className="text-lg font-semibold mb-4">Higgsfield Workflow</h2>
                            <WorkflowPanel />
                        </div>
                    )}
                    {activeSection === "export" && (
                        <div>
                            <WorkflowPanel />
                        </div>
                    )}
                </div>

                {/* Center - Video Preview */}
                <div className="flex items-center justify-center flex-col flex-[1] overflow-hidden">
                    <ProjectName />
                    <PreviewPlayer />
                </div>

                {/* Right Sidebar - Element Properties */}
                <div className="min-h-0 flex-[0.4] min-w-[200px] overflow-y-auto border-l border-gray-800 p-4">
                    {activeElement === "media" && (
                        <div>
                            <h2 className="text-lg font-semibold mb-4">Media Properties</h2>
                            <MediaProperties />
                        </div>
                    )}
                    {activeElement === "text" && (
                        <div>
                            <h2 className="text-lg font-semibold mb-4">Text Properties</h2>
                            <TextProperties />
                        </div>
                    )}
                </div>
            </div>
            {/* Timeline at bottom */}
            <div className="flex flex-row border-t border-gray-500">
                <div className=" bg-darkSurfacePrimary flex flex-col items-center justify-center mt-20">

                    <div className="relative h-16">
                        <div className="flex items-center gap-2 p-4">
                            <Image
                                alt="Video"
                                className="invert h-auto w-auto max-w-[30px] max-h-[30px]"
                                height={30}
                                width={30}
                                src="https://www.svgrepo.com/show/532727/video.svg"
                            />
                        </div>
                    </div>

                    <div className="relative h-16">
                        <div className="flex items-center gap-2 p-4">
                            <Image
                                alt="Video"
                                className="invert h-auto w-auto max-w-[30px] max-h-[30px]"
                                height={30}
                                width={30}
                                src="https://www.svgrepo.com/show/532708/music.svg"
                            />
                        </div>
                    </div>

                    <div className="relative h-16">
                        <div className="flex items-center gap-2 p-4">
                            <Image
                                alt="Video"
                                className="invert h-auto w-auto max-w-[30px] max-h-[30px]"
                                height={30}
                                width={30}
                                src="https://www.svgrepo.com/show/535454/image.svg"
                            />
                        </div>
                    </div>

                    <div className="relative h-16">
                        <div className="flex items-center gap-2 p-4">
                            <Image
                                alt="Video"
                                className="invert h-auto w-auto max-w-[30px] max-h-[30px]"
                                height={30}
                                width={30}
                                src="https://www.svgrepo.com/show/535686/text.svg"
                            />
                        </div>
                    </div>
                </div>
                <Timeline />
            </div>
        </div >
    );
}
