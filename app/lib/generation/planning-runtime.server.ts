import {buildStoryboardFromBrief} from './storyboard-from-brief.server';
import {createDeepSeekPlanningProvider, type PlanningProvider} from './deepseek-planning-provider.server';
import {deriveCharacterSheet, deriveInterviewBrief} from './interview-agent.server';
import type {StyleBible} from '@/app/lib/workflow/schema';

export const defaultStyleBible = (tone: string): StyleBible => ({
  visualMedium: 'cinematic photographic realism',
  realism: 'natural animal anatomy and realistic proportions',
  renderLanguage: 'premium live-action commercial photography, not illustration or 3D animation',
  proportionRules: 'species-accurate anatomy, natural eyes and limbs, no anthropomorphic mascot proportions',
  lighting: `soft directional studio lighting adapted to ${tone}, consistent key-to-fill ratio`,
  lensAndDepth: '50mm cinema lens language, eye-level perspective, moderate natural depth of field',
  background: 'seamless warm-neutral studio background with consistent floor horizon',
  textureAndColor: 'physically plausible fur detail, restrained saturation, consistent cinematic color science',
  negativeConstraints: ['no cartoon', 'no 3D mascot', 'no oversized eyes', 'no chibi proportions', 'no text', 'no logo', 'no watermark'],
});

const rulesProvider: PlanningProvider = {
  provider: 'rules',
  model: 'deterministic-rules-v1',
  compose: async (sentence) => {
    const interviewBrief = deriveInterviewBrief(sentence);
    const characterSheet = deriveCharacterSheet(interviewBrief);
    return {
      interviewBrief,
      styleBible: defaultStyleBible(interviewBrief.tone),
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
