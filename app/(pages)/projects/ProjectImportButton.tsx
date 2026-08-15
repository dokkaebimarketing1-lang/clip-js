'use client';

import {type ChangeEvent, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {FiUpload} from 'react-icons/fi';
import {toast} from 'react-hot-toast';
import {storeProject, useAppDispatch} from '../../store';
import {addProject} from '../../store/slices/projectsSlice';
import {importProjectIntoCurrentProject, parseProjectDocumentJson, ProjectImportError} from '@/app/lib/workflow/project-file';

type ProjectImportButtonProps = {
    readonly disabled: boolean;
};

export const ProjectImportButton = ({disabled}: ProjectImportButtonProps) => {
    const dispatch = useAppDispatch();
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const [isImporting, setIsImporting] = useState(false);
    const isDisabled = disabled || isImporting;

    const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setIsImporting(true);
        try {
            const restored = parseProjectDocumentJson(await file.text());
            const importedAt = new Date().toISOString();
            const project = {
                ...importProjectIntoCurrentProject(restored, crypto.randomUUID()),
                createdAt: importedAt,
                lastModified: importedAt,
            };
            await storeProject(project);
            dispatch(addProject(project));
            toast.success('프로젝트를 가져왔습니다.');
            router.push(`/projects/${project.id}`);
        } catch (error) {
            if (error instanceof ProjectImportError) {
                toast.error(error.code === 'invalid-json'
                    ? 'JSON 파일을 읽을 수 없습니다. 올바른 ClipJS 프로젝트 파일인지 확인해 주세요.'
                    : 'ClipJS 프로젝트 파일이 아니거나 지원하지 않는 버전입니다.');
            } else {
                toast.error('프로젝트 파일을 읽거나 저장하지 못했습니다. 브라우저 저장소를 확인해 주세요.');
            }
        } finally {
            setIsImporting(false);
        }
    };

    return (
        <>
            <input ref={inputRef} type="file" accept="application/json,.json" disabled={isDisabled} onChange={(event) => void handleImport(event)} className="sr-only" aria-label="ClipJS 프로젝트 JSON 파일 선택" />
            <button type="button" disabled={isDisabled} onClick={() => inputRef.current?.click()} aria-label="프로젝트 가져오기" className="group flex h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-extrabold text-gray-200 transition-colors hover:border-fuchsia-400/30 hover:bg-fuchsia-400/[0.08] hover:text-fuchsia-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40">
                <FiUpload className="h-4 w-4" aria-hidden="true" /> {isImporting ? '가져오는 중…' : '프로젝트 가져오기'}
            </button>
        </>
    );
};
