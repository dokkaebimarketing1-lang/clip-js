import {describe, expect, it} from 'vitest';
import {POST} from './route';

const post = (sentence: unknown) =>
  POST(new Request('http://localhost/api/vlog/compose', {
    method: 'POST',
    body: JSON.stringify({sentence}),
  }));

describe('VLOG compose 라우트 (8단계 통합)', () => {
  it('빈 문장이면 400', async () => {
    const res = await post('');
    expect(res.status).toBe(400);
  });

  it('한 문장으로 8단계를 거쳐 brief/시트/스토리보드/28축을 반환한다', async () => {
    const res = await post('고양이와 인사하는 30초 VLOG 만들어줘');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.stage).toBe('compose-preview');
    expect(data.interviewBrief.subject).toBe('고양이');
    expect(data.characterSheet.name).toBe('루이');
    expect(data.storyboard.cuts).toHaveLength(3);
    expect(data.seedanceMaster.axes.camera).toBe('vlog');
    expect(data.imageStoryboard.length).toBeGreaterThan(0);
    expect(data.imageStoryboard[0].placeholder).toContain('[IMAGE CONTI FAKE]');
  });

  it('강아지 문장은 20초/4stage로 해석', async () => {
    const res = await post('강아지와 인사하는 20초 브이로그');
    const data = await res.json();
    expect(data.interviewBrief.durationSeconds).toBe(20);
    expect(data.seedanceMaster.axes.durationStructure).toBe('20s-4stage');
  });
});
