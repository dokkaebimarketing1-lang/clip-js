import {describe, expect, it} from 'vitest';
import {validateCharacterStyleLineage} from './style-lineage';

const hash = 'a'.repeat(64);
const anchorId = `ga_${'1'.repeat(32)}`;
const childId = `ga_${'2'.repeat(32)}`;
const sheet = (id: string, referenceImageId: string, styleReferenceImageIds?: string[]) => ({
  id,
  name: id,
  palette: {dominant: '#111111', secondary: '#222222', accent: '#333333'},
  visualTags: [],
  referenceImageId,
  referenceStyleHash: hash,
  styleReferenceImageIds,
});

describe('character style lineage', () => {
  it('accepts exactly one anchor and inherited characters that reference it', () => {
    expect(validateCharacterStyleLineage([
      sheet('CHAR01', anchorId, []),
      sheet('CHAR02', childId, [anchorId]),
    ], hash)).toMatchObject({valid: true, anchorReferenceImageId: anchorId});
  });

  it('rejects two independently generated characters with the same claimed style hash', () => {
    expect(validateCharacterStyleLineage([
      sheet('CHAR01', anchorId, []),
      sheet('CHAR02', childId, []),
    ], hash)).toMatchObject({valid: false, reason: 'ANCHOR_COUNT_INVALID'});
  });

  it('rejects a child that did not use the project anchor as an image reference', () => {
    expect(validateCharacterStyleLineage([
      sheet('CHAR01', anchorId, []),
      sheet('CHAR02', childId, [`ga_${'3'.repeat(32)}`]),
    ], hash)).toMatchObject({valid: false, reason: 'ANCHOR_REFERENCE_MISSING'});
  });
});
