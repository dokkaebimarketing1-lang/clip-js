import {computeStoryboardHash} from './approval';
import {sha256} from './hash';
import {
  characterSheetSchema,
  creativeApprovalSchema,
  storyboardSchema,
  type CharacterSheet,
  type CreativeApproval,
  type Storyboard,
} from './schema';

export const staleCreativeApprovalMessage = '승인 요청 중 스토리보드 또는 캐릭터 기준이 변경되었습니다. 현재 내용을 다시 확인한 뒤 승인하세요.';

export type CreativeApprovalCommand = {
  approval: CreativeApproval;
  expectedStoryboard: Storyboard;
  expectedCharacterSheets: CharacterSheet[];
};

export const prepareCreativeApprovalCommand = async (
  requestStoryboard: Storyboard,
  requestCharacterSheets: CharacterSheet[],
  responseApproval: CreativeApproval,
): Promise<CreativeApprovalCommand> => {
  const approval = creativeApprovalSchema.parse(responseApproval);
  const expectedStoryboard = storyboardSchema.parse(requestStoryboard);
  const expectedCharacterSheets = requestCharacterSheets.map((sheet) => characterSheetSchema.parse(sheet));
  if (
    approval.status !== 'approved'
    || expectedCharacterSheets.length === 0
    || !approval.storyboardHash
    || !approval.characterSheetHash
  ) throw new Error(staleCreativeApprovalMessage);

  const [storyboardHash, characterSheetHash] = await Promise.all([
    computeStoryboardHash(expectedStoryboard),
    sha256(expectedCharacterSheets),
  ]);
  if (storyboardHash !== approval.storyboardHash || characterSheetHash !== approval.characterSheetHash) {
    throw new Error(staleCreativeApprovalMessage);
  }
  return {approval, expectedStoryboard, expectedCharacterSheets};
};
