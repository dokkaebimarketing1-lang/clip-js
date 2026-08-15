'use client';

import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {FiPlayCircle} from 'react-icons/fi';
import {toast} from 'react-hot-toast';
import {storeProject, useAppDispatch} from '../../store';
import {addProject, setCurrentProject} from '../../store/slices/projectsSlice';
import type {ProjectState} from '../../types';

type SampleProjectButtonProps = {
    readonly disabled: boolean;
    readonly createProjectState: (name: string) => ProjectState;
};

export const SampleProjectButton = ({disabled, createProjectState}: SampleProjectButtonProps) => {
    const dispatch = useAppDispatch();
    const router = useRouter();
    const [isOpening, setIsOpening] = useState(false);

    const handleStartSample = async () => {
        setIsOpening(true);
        const project = createProjectState('함께봄 샘플 프로젝트');
        try {
            await storeProject(project);
            dispatch(addProject(project));
            dispatch(setCurrentProject(project.id));
            router.push(`/projects/${project.id}?sample=1`);
        } catch (error) {
            setIsOpening(false);
            if (!(error instanceof Error)) throw error;
            toast.error('샘플 프로젝트를 열지 못했습니다. 브라우저 저장소를 확인해 주세요.');
        }
    };

    return (
        <button
            type="button"
            disabled={disabled || isOpening}
            onClick={() => void handleStartSample()}
            aria-label="읽기 전용 샘플 프로젝트로 시작"
            className="group flex h-12 items-center justify-center gap-2 rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/[0.06] px-4 text-sm font-extrabold text-fuchsia-100 transition-colors hover:border-fuchsia-400/40 hover:bg-fuchsia-400/[0.11] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
            <FiPlayCircle className="h-4 w-4" aria-hidden="true" /> {isOpening ? '샘플 여는 중…' : '샘플 프로젝트로 시작'}
        </button>
    );
};
