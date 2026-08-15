import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {POST} from './route';

beforeEach(() => {
  vi.stubEnv('CLIPJS_PLANNING_PROVIDER', 'rules');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const post = (sentence: unknown) =>
  POST(new Request('http://localhost/api/vlog/compose', {
    method: 'POST',
    body: JSON.stringify({sentence}),
  }));

describe('VLOG compose 라우트 (8단계 통합)', () => {
  it('기획 provider 설정이 없으면 구조화된 한국어 오류를 반환한다', async () => {
    vi.stubEnv('CLIPJS_PLANNING_PROVIDER', '');
    const res = await post('햄버트 20초 단편 영화');
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: '기획 AI 연결이 준비되지 않았습니다. 관리자에게 배포 환경 설정을 확인해 달라고 요청해 주세요.',
      code: 'PLANNING_PROVIDER_UNAVAILABLE',
    });
  });

  it('빈 문장이면 400', async () => {
    const res = await post('');
    expect(res.status).toBe(400);
  });

  it('한 문장으로 brief와 캐릭터 시트까지만 반환하고 스토리보드는 기준 이미지 뒤로 미룬다', async () => {
    const res = await post('고양이와 인사하는 30초 VLOG 만들어줘');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.stage).toBe('character-plan');
    expect(data.planningProvider).toBe('rules');
    expect(data.planningModel).toBe('deterministic-rules-v1');
    expect(data.interviewBrief.subject).toBe('고양이');
    expect(data.characterSheet.name).toBe('루이');
    expect(data.storyboard).toBeUndefined();
    expect(data.seedanceMaster.axes.camera).toBe('vlog');
    expect(data.imageStoryboard).toBeUndefined();
  });

  it('강아지 문장은 20초/4stage로 해석', async () => {
    const res = await post('강아지와 인사하는 20초 브이로그');
    const data = await res.json();
    expect(data.interviewBrief.durationSeconds).toBe(20);
    expect(data.seedanceMaster.duration).toBe(20);
    expect(data.seedanceMaster.resolution).toBe('480p');
    expect(data.seedanceMaster.axes.durationStructure).toBe('20s-4stage');
  });
});
