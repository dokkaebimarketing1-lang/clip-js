"use client";

import {useState} from 'react';
import type {InterviewBrief, CharacterSheet, Storyboard} from '@/app/lib/workflow/schema';

type StageId = 'sentence' | 'interview' | 'image' | 'character' | 'approve' | 'storyboard' | 'axes' | 'prompt';

const STAGES: {id: StageId; num: string; label: string}[] = [
  {id: 'sentence', num: '①', label: '문장'},
  {id: 'interview', num: '②', label: '인터뷰'},
  {id: 'image', num: '③', label: '이미지 콘티'},
  {id: 'character', num: '④', label: '캐릭터'},
  {id: 'approve', num: '⑤', label: '승인'},
  {id: 'storyboard', num: '⑥', label: '스토리보드'},
  {id: 'axes', num: '⑦', label: '28축'},
  {id: 'prompt', num: '⑧', label: '프롬프트'},
];

// 임의 목업: 컴포즈 전에도 예시를 보여주기 위함
const MOCK_INTERVIEW = {
  subject: '루이(고양이)',
  action: '인사하는 30초 VLOG',
  durationSeconds: 30,
  tone: '자연스러운 일상',
} as const;

const MOCK_CHARACTER = {
  name: '루이',
  breed: '폼메이션',
  visualTags: ['크림색 털', '동그란 눈', '분홍색 목걸이'],
} as const;

const MOCK_SHOTS = [
  {cut: '오프닝', startSeconds: 0, endSeconds: 8, camera: 'vlog', action: '루이가 창가에서 기지개를 켜며 카메라를 향해 눈을 깜빡인다', dialogue: '안녕~ 나 루이야', sfx: '새 소리'},
  {cut: '본편', startSeconds: 8, endSeconds: 20, camera: 'medium', action: '루이가 소파 위를 가로지르며 장난감을 툭툭 친다', dialogue: '오늘도 신나는 하루!', sfx: '발톱 소리'},
  {cut: '턴', startSeconds: 20, endSeconds: 30, camera: 'close-up', action: '루이가 카메라 가까이 다가와 큰 눈으로 인사하며 꼬리를 흔든다', dialogue: '다음에도 놀러와!', sfx: '고양이 소리'},
] as const;

/**
 * 중앙 캔버스: 8단계 파이프라인 노드 + 스토리보드 샷 노드.
 * 노드 클릭 → 디테일 패널. 연결선으로 흐름 표시.
 * props가 비어있으면 목업 예시를 보여준다.
 */
export default function PipelineCanvas({
  interviewBrief,
  characterSheet,
  storyboard,
}: {
  interviewBrief?: InterviewBrief;
  characterSheet?: CharacterSheet;
  storyboard?: Storyboard;
}) {
  const [selectedStage, setSelectedStage] = useState<StageId | null>(null);
  const [selectedShot, setSelectedShot] = useState<number | null>(null);
  const isMock = !storyboard;

  const shots = storyboard?.cuts.flatMap((cut) =>
    cut.shots.map((shot) => ({cut: cut.title, ...shot})),
  ) ?? MOCK_SHOTS;

  const ib = interviewBrief ?? MOCK_INTERVIEW;
  const cs = characterSheet ?? MOCK_CHARACTER;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-neutral-950">
      {/* 8단계 파이프라인 노드 라인 */}
      <div className="shrink-0 border-b border-white/10 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-fuchsia-300">
          AI 감독 파이프라인
          {isMock && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-300">예시 목업</span>}
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {STAGES.map((stage, i) => {
            const active = selectedStage === stage.id;
            const done = stage.id === 'sentence' || (stage.id === 'interview' && !!interviewBrief) || (stage.id === 'character' && !!characterSheet) || (stage.id === 'storyboard' && !!storyboard);
            return (
              <div key={stage.id} className="flex items-center gap-1">
                <button
                  onClick={() => { setSelectedStage(stage.id); setSelectedShot(null); }}
                  className={`flex min-w-[64px] flex-col items-center rounded-lg border px-2 py-2 text-center transition ${active ? 'border-fuchsia-500 bg-fuchsia-500/20' : done ? 'border-fuchsia-500/40 bg-fuchsia-500/10' : 'border-white/10 bg-white/5 hover:border-white/30'}`}
                >
                  <span className="text-base font-bold text-fuchsia-300">{stage.num}</span>
                  <span className="mt-1 text-[10px] text-gray-300">{stage.label}</span>
                </button>
                {i < STAGES.length - 1 && <span className="text-fuchsia-400/50">→</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* 본문: 샷 노드 그리드 + 디테일 */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-y-auto p-3">
          <div className="mb-2 text-xs font-semibold text-gray-300">스토리보드 샷 ({shots.length})</div>
          {shots.length === 0 ? (
            <p className="text-xs text-gray-500">왼쪽 VLOG 탭에서 문장을 입력하고 컴포즈하면 샷이 여기에 노드로 표시됩니다.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {shots.map((shot, idx) => {
                const active = selectedShot === idx;
                return (
                  <button
                    key={idx}
                    onClick={() => { setSelectedShot(idx); setSelectedStage(null); }}
                    className={`rounded-lg border p-2 text-left transition ${active ? 'border-fuchsia-500 bg-fuchsia-500/15' : 'border-white/10 bg-white/5 hover:border-white/30'}`}
                  >
                    <div className="text-[10px] font-semibold text-fuchsia-300">#{idx + 1} · {Math.round(shot.startSeconds)}–{Math.round(shot.endSeconds)}s</div>
                    <div className="mt-1 text-[11px] text-gray-200 line-clamp-2">{shot.action}</div>
                    <div className="mt-1 text-[9px] text-gray-500">{shot.camera}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 디테일 패널 */}
        <div className="w-[260px] shrink-0 overflow-y-auto border-l border-white/10 bg-black/40 p-3">
          {selectedShot !== null && shots[selectedShot] ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-fuchsia-300">샷 #{selectedShot + 1} 디테일</div>
              <DetailRow label="컷" value={shots[selectedShot].cut} />
              <DetailRow label="시간" value={`${Math.round(shots[selectedShot].startSeconds)}–${Math.round(shots[selectedShot].endSeconds)}s`} />
              <DetailRow label="카메라" value={shots[selectedShot].camera} />
              <DetailRow label="액션" value={shots[selectedShot].action} />
              <DetailRow label="대사" value={shots[selectedShot].dialogue} />
              <DetailRow label="SFX" value={shots[selectedShot].sfx} />
              <div className="mt-2 rounded bg-fuchsia-600/20 px-2 py-1 text-center text-[10px] text-fuchsia-200">▶ 이 샷 재생 구간 (클립 생성 후 활성화)</div>
            </div>
          ) : selectedStage ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-fuchsia-300">{STAGES.find((s) => s.id === selectedStage)?.num} {STAGES.find((s) => s.id === selectedStage)?.label} 단계</div>
              {selectedStage === 'interview' && (
                <>
                  <DetailRow label="주체" value={ib.subject} />
                  <DetailRow label="행동" value={ib.action} />
                  <DetailRow label="길이" value={`${ib.durationSeconds}s`} />
                  <DetailRow label="톤" value={ib.tone} />
                </>
              )}
              {selectedStage === 'character' && (
                <>
                  <DetailRow label="이름" value={cs.name} />
                  <DetailRow label="품종" value={cs.breed ?? '—'} />
                  <DetailRow label="외형" value={cs.visualTags.join(', ')} />
                </>
              )}
              {selectedStage === 'storyboard' && (
                <>
                  <DetailRow label="제목" value={storyboard?.title ?? '고양이 VLOG (예시)'} />
                  <DetailRow label="컷 수" value={`${storyboard?.cuts.length ?? MOCK_SHOTS.length}`} />
                </>
              )}
              {!interviewBrief && !characterSheet && !storyboard && (
                <p className="text-[11px] text-gray-500">아직 데이터 없음. 왼쪽 VLOG 탭에서 컴포즈하세요.</p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-gray-500">노드를 클릭하면 상세가 여기에 표시됩니다.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({label, value}: {label: string; value: string}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-[11px] text-gray-200">{value}</div>
    </div>
  );
}
