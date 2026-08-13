import {describe, expect, it, vi} from 'vitest';
import {createDeepSeekPlanningProvider, DEEPSEEK_PLANNING_MODEL, MODELARK_CHAT_COMPLETIONS_URL} from './deepseek-planning-provider.server';

const validPlan = {
  styleBible: {
    visualMedium: 'cinematic photography',
    realism: 'natural photorealism',
    renderLanguage: 'live-action DSLR image',
    proportionRules: 'natural species anatomy and stable scale',
    lighting: 'soft daylight with stable direction',
    lensAndDepth: '50mm eye-level framing with natural depth of field',
    background: 'coherent travel environment with restrained detail',
    textureAndColor: 'natural fur texture and warm balanced color science',
    negativeConstraints: ['no cartoon rendering', 'no style drift', 'no text or logo'],
  },
  interviewBrief: {
    subject: '고양이',
    action: '카메라를 향해 인사한다',
    durationSeconds: 20,
    tone: '따뜻하고 자연스러운 일상',
    characterName: '루이',
    characterBreed: '폼메이션',
    greetingLine: '안녕!',
    extraNotes: '실내 브이로그',
  },
  characterSheet: {
    name: '루이',
    breed: '폼메이션',
    palette: {dominant: '#cccccc', secondary: '#888888', accent: '#ffd43b'},
    visualTags: ['고양이', '회색 털'],
  },
  storyboard: {
    version: 'v1',
    title: '루이의 인사',
    noBgm: true,
    cuts: [{
      id: 'CUT01', title: 'Opening', absoluteStartSeconds: 0, absoluteEndSeconds: 20,
      shots: [{
        id: 'S1', startSeconds: 0, endSeconds: 20,
        startFrame: '고양이가 화면에 들어온다', endFrame: '앞발을 들고 인사한다',
        camera: 'eye-level medium shot', action: '고양이가 카메라를 보고 앞발을 흔든다',
        dialogue: '안녕!', sfx: 'room ambience',
      }],
    }],
  },
};

describe('ModelArk DeepSeek planning provider', () => {
  it('공식 Chat Completions 계약과 DeepSeek V4 Flash GA 모델을 사용한다', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{message: {content: JSON.stringify(validPlan)}}],
    }), {status: 200, headers: {'content-type': 'application/json'}}));
    const provider = createDeepSeekPlanningProvider({apiKey: 'test-key', fetchImpl});

    const plan = await provider.compose('고양이가 인사하는 20초 브이로그');

    expect(plan.interviewBrief.subject).toBe('고양이');
    expect(fetchImpl).toHaveBeenCalledOnce();
    const calls = fetchImpl.mock.calls as unknown as Array<[string | URL | Request, RequestInit | undefined]>;
    const [url, init] = calls[0];
    expect(url).toBe(MODELARK_CHAT_COMPLETIONS_URL);
    expect(init?.headers).toMatchObject({authorization: 'Bearer test-key'});
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(DEEPSEEK_PLANNING_MODEL);
    expect(body.max_completion_tokens).toBe(4_000);
    expect(body.thinking).toEqual({type: 'disabled'});
    expect(body.messages[0].content).toContain('20-second plan: exactly 4 cuts');
    expect(body.messages[0].content).toContain('30-second plan: exactly 6 cuts');
    expect(body.messages[0].content).toContain('Each cut must contain exactly 1 shot');
    expect(body.messages.at(-1).content).toContain('고양이가 인사하는 20초 브이로그');
  });

  it('마크다운 코드펜스로 감싼 JSON도 구조화 스키마로 검증한다', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{message: {content: `\u0060\u0060\u0060json\n${JSON.stringify(validPlan)}\n\u0060\u0060\u0060`}}],
    }), {status: 200}));
    const provider = createDeepSeekPlanningProvider({apiKey: 'test-key', fetchImpl});
    await expect(provider.compose('문장')).resolves.toMatchObject({interviewBrief: {durationSeconds: 20}});
  });

  it('프레임 번호를 보낸 모델 응답은 시각 묘사 문자열로 정규화한다', async () => {
    const numbered = structuredClone(validPlan);
    numbered.interviewBrief.characterBreed = '';
    numbered.characterSheet.breed = '';
    numbered.storyboard.cuts[0].id = 1 as unknown as string;
    numbered.storyboard.cuts[0].shots[0].id = 1 as unknown as string;
    numbered.storyboard.cuts[0].shots[0].startFrame = 0 as unknown as string;
    numbered.storyboard.cuts[0].shots[0].endFrame = 120 as unknown as string;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{message: {content: JSON.stringify(numbered)}}],
    }), {status: 200}));
    const provider = createDeepSeekPlanningProvider({apiKey: 'test-key', fetchImpl});

    const result = await provider.compose('문장');

    expect(result.interviewBrief.characterBreed).toBeUndefined();
    expect(result.characterSheet.breed).toBeUndefined();
    expect(result.storyboard.cuts[0].id).toBe('CUT01');
    expect(result.storyboard.cuts[0].shots[0].id).toBe('S1');
    expect(result.storyboard.cuts[0].shots[0].startFrame).toContain('시작 화면');
    expect(result.storyboard.cuts[0].shots[0].endFrame).toContain('종료 화면');
  });

  it('keeps two distinct main characters and their per-cut assignments', async () => {
    const multiPlan = structuredClone(validPlan) as typeof validPlan & {characterSheets?: unknown[]};
    multiPlan.characterSheets = [
      {...multiPlan.characterSheet, id: 'CHAR01', name: '코코', breed: '강아지'},
      {...multiPlan.characterSheet, id: 'CHAR02', name: '토리', breed: '다람쥐'},
    ];
    multiPlan.characterSheet = multiPlan.characterSheets[0] as typeof multiPlan.characterSheet;
    multiPlan.storyboard.cuts[0] = {...multiPlan.storyboard.cuts[0], characterIds: ['CHAR01', 'CHAR02']} as typeof multiPlan.storyboard.cuts[0];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(multiPlan)}}]}), {status: 200}));
    const provider = createDeepSeekPlanningProvider({apiKey: 'test-key', fetchImpl});

    const result = await provider.compose('강아지 코코와 다람쥐 토리가 함께 인사하는 20초 영상');

    expect(result.characterSheets.map((sheet) => sheet.name)).toEqual(['코코', '토리']);
    expect(result.storyboard.cuts[0].characterIds).toEqual(['CHAR01', 'CHAR02']);
  });

  it('스키마에 맞지 않는 모델 응답을 fail-closed로 거부한다', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{message: {content: '{"interviewBrief":{}}'}}],
    }), {status: 200}));
    const provider = createDeepSeekPlanningProvider({apiKey: 'test-key', fetchImpl});
    await expect(provider.compose('문장')).rejects.toThrow();
  });

  it('API 키가 없으면 네트워크 호출 전에 거부한다', () => {
    expect(() => createDeepSeekPlanningProvider({apiKey: ''})).toThrow('BYTEPLUS_ARK_API_KEY is required');
  });
});
