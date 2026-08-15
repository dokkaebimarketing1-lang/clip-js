'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import Link from 'next/link';
import {FiArrowRight, FiClock, FiFilm, FiMoreHorizontal, FiPlus, FiTrash2, FiX} from 'react-icons/fi';
import {useAppDispatch, useAppSelector} from '../../store';
import {addProject, deleteProject, rehydrateProjects, setCurrentProject} from '../../store/slices/projectsSlice';
import {deleteProject as deleteProjectFromDB, listProjects, storeProject} from '../../store';
import type {ProjectState} from '../../types';
import {toast} from 'react-hot-toast';
import {createDefaultWorkflow} from '@/app/lib/workflow/schema';
import {deriveProjectCardProgress, type ProjectCardProgress} from '@/app/lib/editor/project-card-progress';
import {ProjectImportButton} from './ProjectImportButton';

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {month: 'short', day: 'numeric'});

const createProjectState = (name: string): ProjectState => ({
    projectSchemaVersion: 3,
    revision: 0,
    id: crypto.randomUUID(),
    projectName: name.trim(),
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    mediaFiles: [],
    textElements: [],
    currentTime: 0,
    isPlaying: false,
    isMuted: false,
    duration: 0,
    activeSection: 'media',
    activeElement: 'text',
    activeElementIndex: 0,
    filesID: [],
    zoomLevel: 1,
    timelineZoom: 100,
    enableMarkerTracking: true,
    resolution: {width: 1920, height: 1080},
    fps: 30,
    aspectRatio: '16:9',
    history: [],
    future: [],
    exportSettings: {
        resolution: '1080p', quality: 'high', speed: 'fastest', fps: 30, format: 'mp4', includeSubtitles: true,
    },
    workflow: createDefaultWorkflow(),
});

export default function Projects() {
    const dispatch = useAppDispatch();
    const {projects} = useAppSelector((state) => state.projects);
    const [isCreating, setIsCreating] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<ProjectState | null>(null);
    const [newProjectName, setNewProjectName] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const createDialogRef = useRef<HTMLElement>(null);
    const deleteDialogRef = useRef<HTMLElement>(null);
    const deleteCancelRef = useRef<HTMLButtonElement>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [progressByProject, setProgressByProject] = useState<Record<string, ProjectCardProgress>>({});
    const sortedProjects = useMemo(() => [...projects].sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()), [projects]);

    useEffect(() => {
        const loadProjects = async () => {
            try {
                dispatch(rehydrateProjects(await listProjects()));
            } catch (error) {
                toast.error('프로젝트를 불러오지 못했습니다. 브라우저 저장소를 확인해 주세요.');
                console.error('Error loading projects:', error);
            } finally {
                setIsLoading(false);
            }
        };
        void loadProjects();
    }, [dispatch]);

    useEffect(() => {
        let active = true;
        const resolveProgress = async () => {
            const entries = await Promise.all(sortedProjects.map(async (project) => {
                const progress = await deriveProjectCardProgress(project).catch(() => ({percent: 0, label: '상태 확인 필요'}));
                return [project.id, progress] as const;
            }));
            if (active) setProgressByProject(Object.fromEntries(entries));
        };
        void resolveProgress();
        return () => {active = false;};
    }, [sortedProjects]);

    useEffect(() => {
        const dialog = isCreating ? createDialogRef.current : pendingDelete ? deleteDialogRef.current : null;
        if (!dialog) return;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const frame = requestAnimationFrame(() => {
            (isCreating ? inputRef.current : deleteCancelRef.current)?.focus();
        });
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                if (isCreating) {
                    setIsCreating(false);
                    setNewProjectName('');
                } else {
                    setPendingDelete(null);
                }
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('keydown', handleKeyDown);
            previousFocus?.focus();
        };
    }, [isCreating, pendingDelete]);

    const closeCreate = () => {
        setIsCreating(false);
        setNewProjectName('');
    };

    const handleCreateProject = async () => {
        if (!newProjectName.trim()) return;
        const project = createProjectState(newProjectName);
        try {
            await storeProject(project);
            dispatch(addProject(project));
            closeCreate();
            toast.success('새 프로젝트를 만들었습니다.');
        } catch {
            // Storage layer reports the actionable error. Keep the dialog open.
        }
    };

    const handleDeleteProject = async () => {
        if (!pendingDelete) return;
        try {
            await deleteProjectFromDB(pendingDelete.id);
            dispatch(deleteProject(pendingDelete.id));
            dispatch(rehydrateProjects(await listProjects()));
            setPendingDelete(null);
            toast.success('프로젝트를 삭제했습니다.');
        } catch {
            // Keep the project visible when IndexedDB deletion fails.
        }
    };

    return (
        <div className="relative min-h-[calc(100vh-8rem)] overflow-hidden">
            <div className="clip-grid-bg pointer-events-none absolute inset-x-0 top-0 h-[34rem]" aria-hidden="true" />
            <main id="main-content" className="relative mx-auto w-full max-w-7xl px-5 pb-24 pt-14 sm:px-8 sm:pt-20">
                <header className="flex flex-col gap-8 border-b border-white/[0.08] pb-10 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-3xl">
                        <p className="clip-eyebrow">Production workspace</p>
                        <h1 className="clip-title mt-4 text-4xl font-black text-white sm:text-5xl">무엇을 만들지 정하면,<br className="hidden sm:block" /> 제작 흐름은 함께봄 Ai영상제작소가 정리합니다.</h1>
                        <p className="mt-5 max-w-xl text-sm leading-7 text-gray-400 sm:text-base">기획부터 캐릭터, 콘티, 생성, 편집까지 프로젝트마다 결정과 승인 상태를 이어서 관리하세요.</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <ProjectImportButton disabled={isLoading} />
                        <button
                            type="button"
                            onClick={() => setIsCreating(true)}
                            aria-label="새 프로젝트 만들기"
                            className="group flex h-12 items-center justify-center gap-3 rounded-xl bg-white px-5 text-sm font-extrabold text-black shadow-[0_12px_40px_rgba(255,255,255,.08)] transition-colors hover:bg-fuchsia-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
                        >
                            <FiPlus className="h-4 w-4" aria-hidden="true" /> 새 프로젝트
                        </button>
                    </div>
                </header>

                <section aria-labelledby="project-list-title" className="pt-10">
                    <div className="mb-6 flex items-center justify-between">
                        <div>
                            <h2 id="project-list-title" className="text-lg font-extrabold text-white">최근 프로젝트</h2>
                            <p className="mt-1 text-xs text-gray-500">최근 수정한 순서로 표시합니다.</p>
                        </div>
                        <span className="clip-number rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-xs font-bold text-gray-400">{projects.length}개</span>
                    </div>

                    {isLoading ? (
                        <div role="status" aria-live="polite" className="grid min-h-64 place-items-center rounded-3xl border border-white/[0.08] bg-white/[0.02]">
                            <div className="flex flex-col items-center gap-4 text-sm text-gray-400"><span className="h-7 w-7 animate-spin rounded-full border-2 border-white/15 border-t-fuchsia-400" aria-hidden="true" />프로젝트를 불러오는 중…</div>
                        </div>
                    ) : sortedProjects.length === 0 ? (
                        <div className="clip-panel grid min-h-[22rem] place-items-center rounded-3xl p-8 text-center">
                            <div className="max-w-md">
                                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-fuchsia-400/20 bg-fuchsia-400/[0.08] text-fuchsia-300"><FiFilm className="h-6 w-6" aria-hidden="true" /></span>
                                <h3 className="mt-6 text-xl font-black text-white">첫 영상을 시작해 보세요</h3>
                                <p className="mt-3 text-sm leading-6 text-gray-400">한 줄 아이디어만 입력하면 기획 초안을 만들고, 직접 확인·수정·승인하며 다음 단계로 이동합니다.</p>
                                <button type="button" onClick={() => setIsCreating(true)} className="mt-7 inline-flex items-center gap-2 rounded-xl bg-fuchsia-500 px-5 py-3 text-sm font-extrabold text-white transition-colors hover:bg-fuchsia-400"><FiPlus aria-hidden="true" /> 프로젝트 만들기</button>
                            </div>
                        </div>
                    ) : (
                        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                            {sortedProjects.map((project, index) => {
                                const progress = progressByProject[project.id] ?? {percent: 0, label: '상태 확인 중'};
                                return (
                                    <article key={project.id} className="clip-panel group relative min-w-0 overflow-hidden rounded-3xl transition-[border-color,transform,box-shadow] hover:-translate-y-1 hover:border-fuchsia-400/30 hover:shadow-[0_28px_80px_rgba(0,0,0,.38)]">
                                        <Link href={`/projects/${project.id}`} onClick={() => dispatch(setCurrentProject(project.id))} className="block p-5">
                                            <div className={`relative h-36 overflow-hidden rounded-2xl border border-white/[0.08] ${index % 3 === 0 ? 'bg-gradient-to-br from-fuchsia-950 via-neutral-950 to-violet-950' : index % 3 === 1 ? 'bg-gradient-to-br from-violet-950 via-neutral-950 to-sky-950' : 'bg-gradient-to-br from-rose-950 via-neutral-950 to-amber-950'}`}>
                                                <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:24px_24px]" aria-hidden="true" />
                                                <span className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-[11px] font-bold text-white/80 backdrop-blur"><FiFilm aria-hidden="true" /> {progress.label}</span>
                                                <span className="clip-number absolute right-4 top-4 text-xs font-black text-white/60">{progress.percent}%</span>
                                            </div>
                                            <div className="mt-5 min-w-0">
                                                <div className="flex min-w-0 items-start gap-3">
                                                    <h3 className="min-w-0 flex-1 truncate text-lg font-black tracking-tight text-white" title={project.projectName}>{project.projectName}</h3>
                                                    <FiArrowRight className="mt-1 shrink-0 text-gray-600 transition-transform group-hover:translate-x-1 group-hover:text-fuchsia-300" aria-hidden="true" />
                                                </div>
                                                <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-violet-500" style={{width: `${progress.percent}%`}} /></div>
                                                <div className="mt-4 flex items-center gap-2 text-xs text-gray-500"><FiClock aria-hidden="true" /> 최근 수정 {dateFormatter.format(new Date(project.lastModified))}</div>
                                            </div>
                                        </Link>
                                        <button type="button" onClick={() => setPendingDelete(project)} className="absolute right-7 top-7 grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-black/55 text-gray-400 opacity-100 backdrop-blur transition-[opacity,color,background-color] hover:bg-red-950/80 hover:text-red-300 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100" aria-label={`${project.projectName} 프로젝트 삭제`}><FiMoreHorizontal aria-hidden="true" /></button>
                                    </article>
                                );
                            })}
                            <button type="button" onClick={() => setIsCreating(true)} className="group grid min-h-[19rem] place-items-center rounded-3xl border border-dashed border-white/15 bg-white/[0.015] p-8 text-center transition-colors hover:border-fuchsia-400/35 hover:bg-fuchsia-400/[0.035]">
                                <span><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-gray-400 transition-colors group-hover:border-fuchsia-400/25 group-hover:text-fuchsia-300"><FiPlus className="h-5 w-5" aria-hidden="true" /></span><span className="mt-4 block text-sm font-extrabold text-gray-300">새 프로젝트 추가</span><span className="mt-2 block text-xs text-gray-600">새로운 아이디어로 시작</span></span>
                            </button>
                        </div>
                    )}
                </section>
            </main>

            {isCreating ? (
                <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-5 backdrop-blur-sm" role="presentation" onMouseDown={(event) => {if (event.target === event.currentTarget) closeCreate();}}>
                    <section ref={createDialogRef} role="dialog" aria-modal="true" aria-labelledby="create-project-title" className="clip-panel w-full max-w-md rounded-3xl p-6 sm:p-7">
                        <div className="flex items-start justify-between gap-4">
                            <div><p className="clip-eyebrow">New project</p><h2 id="create-project-title" className="mt-2 text-2xl font-black text-white">새 프로젝트 만들기</h2></div>
                            <button type="button" onClick={closeCreate} className="grid h-9 w-9 place-items-center rounded-xl text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-white" aria-label="닫기"><FiX aria-hidden="true" /></button>
                        </div>
                        <label htmlFor="project-name" className="mt-7 block text-sm font-bold text-gray-300">프로젝트 이름</label>
                        <input id="project-name" name="project-name" autoComplete="off" ref={inputRef} value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} onKeyDown={(event) => {if (event.key === 'Enter') void handleCreateProject(); if (event.key === 'Escape') closeCreate();}} placeholder="예: 여름 캠페인 브랜드 필름…" className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:border-fuchsia-400/50" />
                        <p className="mt-3 text-xs leading-5 text-gray-500">나중에 언제든 이름을 바꿀 수 있습니다.</p>
                        <div className="mt-7 flex justify-end gap-2"><button type="button" onClick={closeCreate} className="rounded-xl px-4 py-2.5 text-sm font-bold text-gray-400 transition-colors hover:bg-white/[0.05] hover:text-white">취소</button><button type="button" disabled={!newProjectName.trim()} onClick={() => void handleCreateProject()} className="rounded-xl bg-white px-5 py-2.5 text-sm font-extrabold text-black transition-colors hover:bg-fuchsia-100 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-600">프로젝트 만들기</button></div>
                    </section>
                </div>
            ) : null}

            {pendingDelete ? (
                <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-5 backdrop-blur-sm" role="presentation">
                    <section ref={deleteDialogRef} role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title" aria-describedby="delete-project-description" className="clip-panel w-full max-w-md rounded-3xl p-7">
                        <span className="grid h-11 w-11 place-items-center rounded-2xl border border-red-400/20 bg-red-400/[0.08] text-red-300"><FiTrash2 aria-hidden="true" /></span>
                        <h2 id="delete-project-title" className="mt-5 text-xl font-black text-white">프로젝트를 삭제할까요?</h2>
                        <p id="delete-project-description" className="mt-3 break-words text-sm leading-6 text-gray-400"><strong className="text-gray-200">{pendingDelete.projectName}</strong> 프로젝트와 브라우저에 저장된 편집 데이터가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.</p>
                        <div className="mt-7 flex justify-end gap-2"><button ref={deleteCancelRef} type="button" onClick={() => setPendingDelete(null)} className="rounded-xl px-4 py-2.5 text-sm font-bold text-gray-400 transition-colors hover:bg-white/[0.05] hover:text-white">취소</button><button type="button" onClick={() => void handleDeleteProject()} className="rounded-xl bg-red-500 px-5 py-2.5 text-sm font-extrabold text-white transition-colors hover:bg-red-400">삭제</button></div>
                    </section>
                </div>
            ) : null}
        </div>
    );
}
