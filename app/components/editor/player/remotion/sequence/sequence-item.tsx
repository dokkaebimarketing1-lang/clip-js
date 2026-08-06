import type {ReactElement} from 'react';
import type {MediaFile, TextElement} from '@/app/types';
import {TextSequenceItem} from './items/text-sequence-item';
import {AudioSequenceItem} from './items/audio-sequence-item';
import {VideoSequenceItem} from './items/video-sequence-item';
import {ImageSequenceItem} from './items/image-sequence-item';

interface SequenceItemOptions {
    handleTextChange?: (id: string, text: string) => void;
    fps: number;
    editableTextId?: string | null;
    currentTime?: number;
}

type SequenceRenderer = (item: unknown, options: SequenceItemOptions) => ReactElement;

export const SequenceItem: Record<string, SequenceRenderer> = {
    video: (item, options) => <VideoSequenceItem item={item as MediaFile} options={options} />,
    text: (item, options) => <TextSequenceItem item={item as TextElement} options={options} />,
    image: (item, options) => <ImageSequenceItem item={item as MediaFile} options={options} />,
    audio: (item, options) => <AudioSequenceItem item={item as MediaFile} options={options} />,
};
