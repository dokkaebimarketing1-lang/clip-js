import React from 'react';
import {Composition, type CalculateMetadataFunction} from 'remotion';
import {ProjectComposition, type ProjectCompositionProps} from './ProjectComposition';
import type {ProjectState} from '../app/types';

const defaultProject: ProjectState = {
  id: 'remotion-default',
  projectName: 'Untitled',
  createdAt: '1970-01-01T00:00:00.000Z',
  lastModified: '1970-01-01T00:00:00.000Z',
  mediaFiles: [],
  textElements: [],
  currentTime: 0,
  isPlaying: false,
  isMuted: false,
  duration: 1,
  activeSection: 'media',
  activeElement: null,
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
  exportSettings: {resolution: '1080p', quality: 'high', speed: 'fastest', fps: 30, format: 'mp4', includeSubtitles: true},
  workflow: {approval: {status: 'draft'}, higgsfieldAssets: [], transitions: [], effects: [], captions: [], production: {assets: [], continuityLocks: [], shotSpecs: [], takes: []}},
};

const calculateMetadata: CalculateMetadataFunction<ProjectCompositionProps> = ({props}) => ({
  durationInFrames: Math.max(1, Math.ceil(props.project.duration * props.project.fps)),
  fps: props.project.fps,
  width: props.project.resolution.width,
  height: props.project.resolution.height,
});

export const RemotionRoot: React.FC = () => (
  <Composition
    id="ClipJsProject"
    component={ProjectComposition}
    durationInFrames={1}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{project: defaultProject}}
    calculateMetadata={calculateMetadata}
  />
);
