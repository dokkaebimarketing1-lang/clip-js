import {
  characterSheetSchema,
  interviewBriefSchema,
  storyboardSchema,
  styleBibleSchema,
  type CharacterSheet,
  type InterviewBrief,
  type Storyboard,
  type StyleBible,
} from './schema';

export type StoryboardInstallCommand = {
  expectedInterviewBrief: InterviewBrief;
  expectedStyleBible: StyleBible;
  expectedStyleBibleHash: string;
  expectedCharacterSheets: CharacterSheet[];
  storyboard: Storyboard;
};

export const prepareStoryboardInstallCommand = ({
  interviewBrief,
  styleBible,
  styleBibleHash,
  characterSheets,
  storyboard,
}: {
  interviewBrief: InterviewBrief;
  styleBible: StyleBible;
  styleBibleHash: string;
  characterSheets: CharacterSheet[];
  storyboard: unknown;
}): StoryboardInstallCommand => ({
  expectedInterviewBrief: interviewBriefSchema.parse(interviewBrief),
  expectedStyleBible: styleBibleSchema.parse(styleBible),
  expectedStyleBibleHash: styleBibleHash,
  expectedCharacterSheets: characterSheets.map((sheet) => characterSheetSchema.parse(sheet)),
  storyboard: storyboardSchema.parse(storyboard),
});
