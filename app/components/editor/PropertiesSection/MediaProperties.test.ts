import {Children, isValidElement, type ReactElement, type ReactNode} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {setMediaFiles} from '../../../store/slices/projectSlice';
import type {MediaFile, MediaType} from '../../../types';
import MediaProperties from './MediaProperties';

const {dispatchMock, selectorMock} = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  selectorMock: vi.fn(),
}));

vi.mock('../../../store', () => ({
  useAppDispatch: () => dispatchMock,
  useAppSelector: selectorMock,
}));

type SelectProps = {
  readonly children?: ReactNode;
  readonly onChange?: (event: {readonly target: {readonly value: string}}) => void;
};

type OptionProps = {
  readonly value: number;
};

const media = (type: MediaType): MediaFile => ({
  id: 'media-1',
  fileName: `clip.${type === 'audio' ? 'mp3' : 'mp4'}`,
  type,
  startTime: 2,
  endTime: 8,
  positionStart: 10,
  positionEnd: 16,
  includeInMerge: true,
  playbackSpeed: 1,
  volume: 100,
  zIndex: 1,
  opacity: 100,
});

const findSelect = (node: ReactNode): ReactElement<SelectProps> | undefined => {
  if (!isValidElement<SelectProps>(node)) return undefined;
  if (node.type === 'select') return node;

  for (const child of Children.toArray(node.props.children)) {
    const select = findSelect(child);
    if (select) return select;
  }

  return undefined;
};

describe('MediaProperties playback speed', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    selectorMock.mockReset();
  });

  it.each(['video', 'audio'] satisfies readonly MediaType[])('offers supported speeds for a selected %s clip', (type) => {
    const selectedMedia = media(type);
    selectorMock.mockReturnValue({mediaFiles: [selectedMedia], activeElementIndex: 0});

    const select = findSelect(MediaProperties());

    expect(select).toBeDefined();
    if (!select) return;
    const values = Children.toArray(select.props.children).flatMap((child) =>
      isValidElement<OptionProps>(child) ? [child.props.value] : [],
    );
    expect(values).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]);
  });

  it('dispatches playback speed and shortened timeline duration when a speed is selected', () => {
    const selectedMedia = media('video');
    selectorMock.mockReturnValue({mediaFiles: [selectedMedia], activeElementIndex: 0});

    const select = findSelect(MediaProperties());
    select?.props.onChange?.({target: {value: '2'}});

    expect(dispatchMock).toHaveBeenCalledWith(setMediaFiles([{
      ...selectedMedia,
      playbackSpeed: 2,
      positionEnd: 13,
    }]));
  });
});
