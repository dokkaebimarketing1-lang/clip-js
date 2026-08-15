import type {MediaFile} from '@/app/types';

const DETACHED_AUDIO_SUFFIX = '-오디오';

type DetachedAudioMedia = {
  readonly video: MediaFile;
  readonly audio: MediaFile;
};

const sourceIdentity = (media: MediaFile): string | undefined => {
  if (!media.source) return media.remoteUrl ?? media.src ?? media.fileId;

  switch (media.source.kind) {
    case 'indexeddb':
      return `indexeddb:${media.source.fileId}`;
    case 'generated':
      return `generated:${media.source.generatedAssetId}`;
    case 'managed':
      return `managed:${media.source.assetId}`;
    case 'external-unverified':
      return `external-unverified:${media.source.url}`;
  }
};

export const buildDetachedAudioMedia = (video: MediaFile, audioId: string): DetachedAudioMedia => ({
  video: {...video, volume: 0},
  audio: {
    ...video,
    id: audioId,
    fileName: `${video.fileName}${DETACHED_AUDIO_SUFFIX}`,
    type: 'audio',
    zIndex: video.zIndex - 1,
  },
});

export const hasDetachedAudio = (mediaFiles: readonly MediaFile[], video: MediaFile): boolean => {
  const videoSource = sourceIdentity(video);
  return mediaFiles.some((media) =>
    media.type === 'audio'
    && media.fileName === `${video.fileName}${DETACHED_AUDIO_SUFFIX}`
    && media.positionStart === video.positionStart
    && sourceIdentity(media) === videoSource,
  );
};
