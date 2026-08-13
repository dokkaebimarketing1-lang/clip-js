import {buildStoryboardFromBrief} from './storyboard-from-brief.server';
import {createDeepSeekPlanningProvider, type PlanningProvider} from './deepseek-planning-provider.server';
import {deriveCharacterSheet, deriveInterviewBrief} from './interview-agent.server';

const rulesProvider: PlanningProvider = {
  provider: 'rules',
  model: 'deterministic-rules-v1',
  compose: async (sentence) => {
    const interviewBrief = deriveInterviewBrief(sentence);
    const characterSheet = deriveCharacterSheet(interviewBrief);
    return {
      interviewBrief,
      characterSheet,
      characterSheets: [{...characterSheet, id: 'CHAR01'}],
      storyboard: buildStoryboardFromBrief(interviewBrief),
    };
  },
};

export const getConfiguredPlanningProvider = (): PlanningProvider => {
  const provider = process.env.CLIPJS_PLANNING_PROVIDER || 'disabled';
  if (provider === 'byteplus-deepseek') {
    return createDeepSeekPlanningProvider({apiKey: process.env.BYTEPLUS_ARK_API_KEY || ''});
  }
  if (provider === 'rules' && process.env.NODE_ENV === 'test') return rulesProvider;
  throw new Error('No planning provider is enabled. Set CLIPJS_PLANNING_PROVIDER=byteplus-deepseek.');
};
