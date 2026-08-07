import {describe, expect, it} from 'vitest';
import {transitionTypeSchema} from './schema';
import {isOfficialTransition, TRANSITION_CATALOG, transitionProviderFor} from './transition-catalog';

describe('transition catalog', () => {
  it('maps every catalog entry to one official descriptor without duplicates', () => {
    const types = TRANSITION_CATALOG.map((entry) => entry.type);
    expect(new Set(types).size).toBe(types.length);
    TRANSITION_CATALOG.forEach((entry) => {
      expect(transitionTypeSchema.options).toContain(entry.type);
      expect(transitionProviderFor(entry.type)).toBe(entry.provider);
    });
  });

  it('covers every declared transition type except none', () => {
    const catalog = TRANSITION_CATALOG.map((entry) => entry.type).sort();
    const declared = transitionTypeSchema.options.filter((type) => type !== 'none').sort();
    expect(catalog).toEqual(declared);
  });

  it('marks only third-party transitions as official', () => {
    expect(isOfficialTransition('dreamy-zoom')).toBe(true);
    expect(isOfficialTransition('ripple')).toBe(true);
    expect(isOfficialTransition('fade')).toBe(false);
  });
});
