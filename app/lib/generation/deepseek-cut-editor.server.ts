import {z} from 'zod';
import type {StoryboardCut} from '@/app/lib/workflow/schema';
import {DEEPSEEK_PLANNING_MODEL, MODELARK_CHAT_COMPLETIONS_URL} from './deepseek-planning-provider.server';

const editOutputSchema = z.object({
  title: z.string().min(1).max(120),
  action: z.string().min(1).max(300),
  startFrame: z.string().min(1).max(300),
  endFrame: z.string().min(1).max(300),
  camera: z.string().min(1).max(300),
});

const responseSchema = z.object({choices: z.array(z.object({message: z.object({content: z.string().min(1)})})).min(1)});

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const editCutWithDeepSeek = async (input: {
  cut: StoryboardCut;
  instruction: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}): Promise<StoryboardCut> => {
  if (!input.apiKey) throw new Error('BYTEPLUS_ARK_API_KEY is required.');
  const instruction = input.instruction.trim();
  if (!instruction || instruction.length > 1000) throw new Error('Cut edit instruction must be 1–1000 characters.');
  const shot = input.cut.shots[0];
  const response = await (input.fetchImpl ?? fetch)(MODELARK_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${input.apiKey}`},
    body: JSON.stringify({
      model: DEEPSEEK_PLANNING_MODEL,
      messages: [
        {role: 'system', content: 'Edit one Korean commercial-video cut. Return JSON only with title, action, startFrame, endFrame, camera. Preserve user-supplied dialogue exactly. Do not add visible text, numbers, logos, copyrighted characters, or unrelated elements.'},
        {role: 'user', content: JSON.stringify({cut: {title: input.cut.title, action: shot.action, startFrame: shot.startFrame, endFrame: shot.endFrame, camera: shot.camera, dialogue: shot.dialogue}, instruction})},
      ],
      temperature: 0.2,
      thinking: {type: 'disabled'},
      max_completion_tokens: 1000,
      stream: false,
    }),
    signal: input.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`DeepSeek cut edit failed with HTTP ${response.status}.`);
  const parsed = responseSchema.parse(await response.json());
  const raw = parsed.choices[0].message.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const edited = editOutputSchema.parse(JSON.parse(raw));
  return {...input.cut, title: edited.title, shots: input.cut.shots.map((candidate, index) => index === 0 ? {...candidate, action: edited.action, startFrame: edited.startFrame, endFrame: edited.endFrame, camera: edited.camera} : candidate)};
};
