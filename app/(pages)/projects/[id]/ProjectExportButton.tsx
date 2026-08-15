'use client';

import {FiDownload} from 'react-icons/fi';
import type {ProjectState} from '@/app/types';
import {downloadProjectDocument} from '@/app/lib/workflow/project-file';

type ProjectExportButtonProps = {
    readonly project: ProjectState;
    readonly disabled: boolean;
};

export const ProjectExportButton = ({project, disabled}: ProjectExportButtonProps) => (
    <button
        type="button"
        aria-label="프로젝트 JSON 파일 내보내기"
        title="프로젝트 내보내기"
        disabled={disabled}
        onClick={() => downloadProjectDocument(project)}
        className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 text-[11px] font-bold text-gray-300 transition-colors hover:border-fuchsia-400/30 hover:bg-fuchsia-400/[0.08] hover:text-fuchsia-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40"
    >
        <FiDownload className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">내보내기</span>
    </button>
);
