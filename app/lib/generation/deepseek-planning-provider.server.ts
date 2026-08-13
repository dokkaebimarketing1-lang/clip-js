import {z} from 'zod';
import {characterSheetSchema, interviewBriefSchema, storyboardSchema, type CharacterSheet, type InterviewBrief, type Storyboard} from '@/app/lib/workflow/schema';

export const MODELARK_CHAT_COMPLETIONS_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions';
export const DEEPSEEK_PLANNING_MODEL = 'deepseek-v4-flash-ga-260731';

const planningOutputSchema = z.object({
  interviewBrief: interviewBriefSchema,
  characterSheet: characterSheetSchema,
  characterSheets: z.array(characterSheetSchema).min(1).max(10),
  storyboard: storyboardSchema,
}).superRefine((plan, ctx) => {
  const ids = plan.characterSheets.map((sheet) => sheet.id).filter((id): id is string => Boolean(id));
  if (ids.length !== plan.characterSheets.length || new Set(ids).size !== ids.length) {
    ctx.addIssue({code: z.ZodIssueCode.custom, path: ['characterSheets'], message: 'Every main character requires a unique ID.'});
    return;
  }
  const used = new Set(plan.storyboard.cuts.flatMap((cut) => cut.characterIds ?? []));
  for (const cut of plan.storyboard.cuts) {
    for (const characterId of cut.characterIds ?? []) {
      if (!ids.includes(characterId)) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['storyboard', 'cuts'], message: `Unknown character ID: ${characterId}`});
    }
  }
  for (const id of ids) {
    if (!used.has(id)) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['storyboard', 'cuts'], message: `Main character ${id} is not assigned to any cut.`});
  }
});

const chatResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({content: z.string().min(1)}),
  })).min(1),
});

export type PlanningOutput = {
  interviewBrief: InterviewBrief;
  characterSheet: CharacterSheet;
  characterSheets: CharacterSheet[];
  storyboard: Storyboard;
};

export type PlanningProvider = {
  readonly provider: 'byteplus-deepseek' | 'rules';
  readonly model: string;
  compose(sentence: string, signal?: AbortSignal): Promise<PlanningOutput>;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const systemPrompt = `You are the planning director for a Korean commercial AI-video production system.
Convert one user sentence into strict JSON with exactly four top-level keys: interviewBrief, characterSheet, characterSheets, storyboard.
Do not output commentary or markdown.
interviewBrief fields: subject, action, durationSeconds (20 or 30 only), tone, optional characterName, optional characterBreed, greetingLine, extraNotes.
characterSheet is the first primary character for backward compatibility. characterSheets contains every visually distinct main character who appears on screen (for example, a dog and a squirrel must be two separate entries). Each character has id CHAR01, CHAR02..., name, optional breed, palette with dominant/secondary/accent as 6-digit hex colors, and visualTags. Omit incidental background extras. Never merge two distinct main characters into one sheet.
storyboard fields: version="v1", title, noBgm=true, cuts. Each cut has id, title, characterIds listing the CHAR IDs visible in that cut, absoluteStartSeconds, absoluteEndSeconds, shots. Each shot has id, startSeconds, endSeconds, startFrame, endFrame, camera, action, dialogue, sfx.
20-second plan: exactly 4 cuts. 30-second plan: exactly 6 cuts. Each cut must contain exactly 1 shot.
Keep startFrame, endFrame, camera, action, dialogue, and sfx concise; each field must be at most 120 Korean characters.
startFrame and endFrame are visual scene descriptions, never frame numbers or timestamps.
All timestamps must be continuous, non-negative, and end at interviewBrief.durationSeconds. Write natural Korean creative content. Preserve any dialogue supplied by the user exactly. Do not invent copyrighted characters, logos, visible text, numbers, or brands.`;

const unwrapJson = (content: string): unknown => {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced?.[1] ?? trimmed);
};

const normalizePlanningOutput = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return value;
  const root = value as {
    interviewBrief?: Record<string, unknown>;
    characterSheet?: Record<string, unknown>;
    characterSheets?: Array<Record<string, unknown>>;
    storyboard?: {cuts?: Array<{shots?: Array<Record<string, unknown>>}>};
  };
  const sheets = Array.isArray(root.characterSheets)
    ? root.characterSheets
    : root.characterSheet
      ? [root.characterSheet]
      : [];
  root.characterSheets = sheets.map((sheet, index) => {
    const normalized: Record<string, unknown> = {...sheet, id: sheet.id || `CHAR${String(index + 1).padStart(2, '0')}`};
    if (normalized.breed === '') delete normalized.breed;
    if (normalized.referenceImageId === '') delete normalized.referenceImageId;
    return normalized;
  });
  if (!root.characterSheet && root.characterSheets[0]) root.characterSheet = root.characterSheets[0];
  for (const [object, key] of [
    [root.interviewBrief, 'characterName'],
    [root.interviewBrief, 'characterBreed'],
    [root.characterSheet, 'breed'],
    [root.characterSheet, 'referenceImageId'],
  ] as const) {
    if (object?.[key] === '') delete object[key];
  }
  const cuts = root.storyboard?.cuts ?? [];
  for (let cutIndex = 0; cutIndex < cuts.length; cutIndex += 1) {
    const cut = cuts[cutIndex];
    const cutRecord = cut as Record<string, unknown>;
    if (!Array.isArray(cutRecord.characterIds) && root.characterSheets.length === 1) cutRecord.characterIds = [root.characterSheets[0].id];
    if (typeof (cut as Record<string, unknown>).id !== 'string') {
      (cut as Record<string, unknown>).id = `CUT${String(cutIndex + 1).padStart(2, '0')}`;
    }
    const shots = cut.shots ?? [];
    for (let shotIndex = 0; shotIndex < shots.length; shotIndex += 1) {
      const shot = shots[shotIndex];
      if (typeof shot.id !== 'string') shot.id = `S${shotIndex + 1}`;
      const action = typeof shot.action === 'string' && shot.action.trim() ? shot.action : '장면 동작';
      if (typeof shot.startFrame !== 'string') shot.startFrame = `${action} 시작 화면`;
      if (typeof shot.endFrame !== 'string') shot.endFrame = `${action} 종료 화면`;
    }
  }
  return value;
};

export const createDeepSeekPlanningProvider = (options: {
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): PlanningProvider => {
  if (!options.apiKey) throw new Error('BYTEPLUS_ARK_API_KEY is required.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 45_000;

  return {
    provider: 'byteplus-deepseek',
    model: DEEPSEEK_PLANNING_MODEL,
    compose: async (sentence, signal) => {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const controller = new AbortController();
      const abortFrom = (source: AbortSignal) => controller.abort(source.reason);
      for (const source of signal ? [signal, timeoutSignal] : [timeoutSignal]) {
        if (source.aborted) abortFrom(source);
        else source.addEventListener('abort', () => abortFrom(source), {once: true});
      }

      const response = await fetchImpl(MODELARK_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_PLANNING_MODEL,
          messages: [
            {role: 'system', content: systemPrompt},
            {role: 'user', content: sentence.trim()},
          ],
          temperature: 0.2,
          thinking: {type: 'disabled'},
          max_completion_tokens: 4_000,
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`DeepSeek planning request failed with HTTP ${response.status}.`);
      const parsed = chatResponseSchema.parse(await response.json());
      return planningOutputSchema.parse(normalizePlanningOutput(unwrapJson(parsed.choices[0].message.content)));
    },
  };
};
