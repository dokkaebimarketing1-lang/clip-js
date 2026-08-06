import type {TransitionSpec} from './schema';

export type TransitionCatalogEntry = {
  type: TransitionSpec['type'];
  label: string;
  provider: TransitionSpec['provider'];
  license: 'project-native' | 'Remotion License' | 'MIT';
};

export const TRANSITION_CATALOG: readonly TransitionCatalogEntry[] = [
  {type: 'fade', label: 'Fade', provider: 'native', license: 'project-native'},
  {type: 'wipe', label: 'Wipe', provider: 'native', license: 'project-native'},
  {type: 'slide', label: 'Slide', provider: 'native', license: 'project-native'},
  {type: 'whip-pan', label: 'Whip Pan', provider: 'native', license: 'project-native'},
  {type: 'flash', label: 'Flash', provider: 'native', license: 'project-native'},
  {type: 'blur', label: 'Blur', provider: 'native', license: 'project-native'},
  {type: 'push', label: 'Push', provider: 'native', license: 'project-native'},
  {type: 'zoom', label: 'Zoom', provider: 'native', license: 'project-native'},
  {type: 'dreamy-zoom', label: 'Dreamy Zoom', provider: 'remotion', license: 'Remotion License'},
  {type: 'film-burn', label: 'Film Burn', provider: 'remotion', license: 'Remotion License'},
  {type: 'linear-blur', label: 'Linear Blur', provider: 'remotion', license: 'Remotion License'},
  {type: 'ripple', label: 'Ripple', provider: 'gl-transitions', license: 'MIT'},
  {type: 'crosswarp', label: 'Crosswarp', provider: 'gl-transitions', license: 'MIT'},
  {type: 'dissolve', label: 'Dissolve', provider: 'gl-transitions', license: 'MIT'},
  {type: 'cross-zoom', label: 'Cross Zoom', provider: 'gl-transitions', license: 'MIT'},
];

export const transitionProviderFor = (type: TransitionSpec['type']): TransitionSpec['provider'] =>
  TRANSITION_CATALOG.find((entry) => entry.type === type)?.provider ?? 'native';

export const isOfficialTransition = (type: TransitionSpec['type']): boolean =>
  transitionProviderFor(type) !== 'native';
