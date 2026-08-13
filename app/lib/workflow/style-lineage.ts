import type {CharacterSheet} from './schema';

export type StyleLineageValidation = {
  valid: boolean;
  anchorReferenceImageId?: string;
  reason?: 'STYLE_HASH_MISSING' | 'REFERENCE_MISSING' | 'ANCHOR_COUNT_INVALID' | 'ANCHOR_REFERENCE_MISSING';
};

export const validateCharacterStyleLineage = (
  characterSheets: readonly CharacterSheet[],
  styleBibleHash: string | undefined,
): StyleLineageValidation => {
  if (!styleBibleHash) return {valid: false, reason: 'STYLE_HASH_MISSING'};
  if (characterSheets.length === 0 || characterSheets.some((sheet) => !sheet.referenceImageId || sheet.referenceStyleHash !== styleBibleHash)) {
    return {valid: false, reason: 'REFERENCE_MISSING'};
  }
  const anchors = characterSheets.filter((sheet) => (sheet.styleReferenceImageIds ?? []).length === 0);
  if (anchors.length !== 1 || !anchors[0].referenceImageId) return {valid: false, reason: 'ANCHOR_COUNT_INVALID'};
  const anchorReferenceImageId = anchors[0].referenceImageId;
  const inherited = characterSheets.filter((sheet) => sheet !== anchors[0]);
  if (inherited.some((sheet) => !(sheet.styleReferenceImageIds ?? []).includes(anchorReferenceImageId))) {
    return {valid: false, anchorReferenceImageId, reason: 'ANCHOR_REFERENCE_MISSING'};
  }
  return {valid: true, anchorReferenceImageId};
};
