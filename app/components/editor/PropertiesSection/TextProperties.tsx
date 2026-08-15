"use client";

import { useAppSelector } from '../../../store';
import { setTextElements } from '../../../store/slices/projectSlice';
import type { TextElement } from '../../../types';
import { useAppDispatch } from '../../../store';

const TEXT_ANIMATION_OPTIONS = [
    { value: 'none', label: '없음' },
    { value: 'slide-in', label: '슬라이드 인' },
    { value: 'zoom', label: '확대' },
    { value: 'bounce', label: '바운스' },
    { value: 'typewriter', label: '타자 효과' },
    { value: 'shake', label: '흔들림' },
    { value: 'glow', label: '빛나는 효과' },
] as const satisfies ReadonlyArray<{ value: NonNullable<TextElement['animation']>; label: string }>;

export default function TextProperties() {
    const { textElements, activeElementIndex } = useAppSelector((state) => state.projectState);
    const textElement = textElements[activeElementIndex];
    const dispatch = useAppDispatch();

    const onUpdateText = (id: string, updates: Partial<TextElement>) => {
        dispatch(setTextElements(textElements.map(text =>
            text.id === id ? { ...text, ...updates } : text
        )));
    };

    if (!textElement) return null;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-8">
                {/* Text Content */}
                <div className="space-y-2">
                    <h4 className="font-semibold">Text Content</h4>
                    <div>
                        <textarea
                            value={textElement.text}
                            onChange={(e) => onUpdateText(textElement.id, { text: e.target.value })}
                            className="w-full p-2 bg-darkSurfacePrimary border border-white border-opacity-10 shadow-md text-white rounded focus:outline-none focus:ring-2 focus:ring-white-500 focus:border-white-500"
                            rows={3}
                        />
                    </div>
                </div>
                {/* Timing Position */}
                <div className="space-y-2">
                    <h4 className="font-semibold">Timing Position</h4>
                    <div className="flex items-center space-x-4">
                        <div>
                            <label className="block text-sm">시작 (초)</label>
                            <input
                                type="number"
                                value={textElement.positionStart}
                                min={0}
                                readOnly={true}
                                onChange={(e) => onUpdateText(textElement.id, {
                                    positionStart: Number(e.target.value),
                                    positionEnd: Number(e.target.value) + (textElement.positionEnd - textElement.positionStart)
                                })}
                                className="w-full p-2 bg-darkSurfacePrimary border border-white border-opacity-10 shadow-md text-white rounded focus:outline-none focus:ring-2 focus:ring-white-500 focus:border-white-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm">끝 (초)</label>
                            <input
                                type="number"
                                readOnly={true}
                                value={textElement.positionEnd}
                                min={textElement.positionStart}
                                onChange={(e) => onUpdateText(textElement.id, {
                                    positionEnd: Number(e.target.value)
                                })}
                                className="w-full p-2 bg-darkSurfacePrimary border border-white border-opacity-10 shadow-md text-white rounded focus:outline-none focus:ring-2 focus:ring-white-500 focus:border-white-500"
                            />
                        </div>
                    </div>
                </div>
                {/* Visual Properties */}
                <div className="space-y-2">
                    <h4 className="font-semibold">Visual Properties</h4>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm">X 위치</label>
                            <input
                                type="number"
                                step="10"
                                value={textElement.x || 0}
                                onChange={(e) => onUpdateText(textElement.id, { x: Number(e.target.value) })}
                                className="w-full p-2 bg-darkSurfacePrimary border border-white border-opacity-10 shadow-md text-white rounded focus:outline-none focus:ring-2 focus:ring-white-500 focus:border-white-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm">Y 위치</label>
                            <input
                                type="number"
                                step="10"
                                value={textElement.y || 0}
                                onChange={(e) => onUpdateText(textElement.id, { y: Number(e.target.value) })}
                                className="w-full p-2 bg-darkSurfacePrimary border border-white border-opacity-10 shadow-md text-white rounded focus:outline-none focus:ring-2 focus:ring-white-500 focus:border-white-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm">글자 크기</label>
                            <input
                                type="number"
                                step="5"
                                value={textElement.fontSize || 24}
                                onChange={(e) => onUpdateText(textElement.id, { fontSize: Number(e.target.value) })}
                                className="w-full p-2 bg-darkSurfacePrimary border border-white border-opacity-10 shadow-md text-white rounded focus:outline-none focus:ring-2 focus:ring-white-500 focus:border-white-500"
                            />
                        </div>
                        {/* TODO: add z-index */}
                        {/* <div>
                            <label className="block text-sm">레이어 순서</label>
                            <input
                                type="number"
                                value={textElement.zIndex || 0}
                                onChange={(e) => onUpdateText(textElement.id, { zIndex: Number(e.target.value) })}
                                className="w-full p-2 bg-darkSurfacePrimary border border-white border-opacity-10 shadow-md text-white rounded focus:outline-none focus:ring-2 focus:ring-white-500 focus:border-white-500"
                            />
                        </div> */}
                        {/* Font Type */}
                        <div >
                            <label className="block text-sm font-medium text-white">Font Type</label>
                            <select
                                value={textElement.font}
                                onChange={(e) => onUpdateText(textElement.id, { font: e.target.value })}
                                className="w-full p-2 bg-darkSurfacePrimary border border-white border-opacity-10 shadow-md text-white rounded focus:outline-none focus:ring-2 focus:ring-white-500 focus:border-white-500"
                            >
                                <option value="Arial">Arial</option>
                                <option value="Inter">Inter</option>
                                <option value="Lato">Lato</option>
                            </select>
                        </div>
                    </div>
                </div>
                {/* Style Properties */}
                <div className="space-y-2">
                    <h4 className="font-semibold">Style Properties</h4>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm">글자 색상</label>
                            <input
                                type="color"
                                value={textElement.color || '#ffffff'}
                                onChange={(e) => onUpdateText(textElement.id, { color: e.target.value })}
                                className="w-full h-10 bg-darkSurfacePrimary border border-white border-opacity-10 shadow-md rounded focus:outline-none focus:ring-2 focus:ring-white-500 focus:border-white-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm">불투명도</label>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="1"
                                value={textElement.opacity}
                                onChange={(e) => onUpdateText(textElement.id, { opacity: Number(e.target.value) })}
                                className="w-full bg-darkSurfacePrimary border border-white border-opacity-10 shadow-md text-white rounded focus:outline-none focus:border-white-500"
                            />
                        </div>
                        <div>
                            <label htmlFor="text-animation" className="block text-sm">애니메이션</label>
                            <select
                                id="text-animation"
                                value={textElement.animation ?? 'none'}
                                onChange={(event) => {
                                    const animation = TEXT_ANIMATION_OPTIONS.find((option) => option.value === event.target.value)?.value;
                                    if (animation) onUpdateText(textElement.id, { animation });
                                }}
                                className="w-full p-2 bg-darkSurfacePrimary border border-white border-opacity-10 shadow-md text-white rounded focus:outline-none focus:ring-2 focus:ring-white-500 focus:border-white-500"
                            >
                                {TEXT_ANIMATION_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
                <div >
                </div>
            </div>
        </div >
    );
}
