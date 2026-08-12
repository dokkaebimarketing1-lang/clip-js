import { useState, useRef, useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '@/app/store';
import { setProjectName } from "../../../store/slices/projectSlice";

export default function ProjectName() {
    const [isEditing, setIsEditing] = useState(false);
    const { projectName } = useAppSelector((state) => state.projectState);
    const dispatch = useAppDispatch();

    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleClick = () => {
        setIsEditing(true);
    };

    const handleBlur = () => {
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            setIsEditing(false);
        }
        if (e.key === 'Escape') {
            setIsEditing(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        dispatch(setProjectName(e.target.value));
    };

    return (
        <div className="relative">
            {isEditing ? (
                <input
                    ref={inputRef}
                    type="text"
                    value={projectName}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    onKeyDown={handleKeyDown}
                    name="projectName"
                    autoComplete="off"
                    aria-label="프로젝트 이름"
                    className="h-8 min-w-[180px] rounded border border-white/10 bg-black px-2 text-sm font-semibold tracking-tight text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
                    autoFocus
                />
            ) : (
                <button
                    type="button"
                    onClick={handleClick}
                    aria-label={`Edit project name: ${projectName}`}
                    className="flex h-8 max-w-[420px] min-w-0 items-center rounded px-2 text-sm font-semibold tracking-tight text-gray-100 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
                >
                    <span className="truncate">{projectName}</span>
                    <svg aria-hidden="true" className="ml-2 h-3.5 w-3.5 shrink-0 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path>
                    </svg>
                </button>
            )}
        </div>
    );
}