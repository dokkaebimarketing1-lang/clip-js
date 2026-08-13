'use client';

import {getWorkspaceInternalSteps, type ProjectWorkspaceId} from '@/app/lib/editor/project-workspace';
import type {WorkflowState} from '@/app/lib/workflow/schema';

type StageInspectorProps = {
  workspace: ProjectWorkspaceId;
  workflow: WorkflowState;
  mediaCount: number;
  sampleMode: boolean;
  onOpenAdvanced: () => void;
};

const titleByWorkspace: Record<ProjectWorkspaceId, string> = {
  interview: 'AI 기획',
  reference: '기준 자산',
  storyboard: '장면 구성',
  generation: '생성 승인',
  edit: '편집 상태',
};

export default function StageInspector({workspace, workflow, mediaCount, sampleMode, onOpenAdvanced}: StageInspectorProps) {
  const steps = getWorkspaceInternalSteps(workspace);
  const hasBrief = Boolean(workflow.interviewBrief);
  const hasCharacter = Boolean(workflow.characterSheet);
  const hasStoryboard = Boolean(workflow.storyboard);
  const creativeApproved = workflow.creativeApproval.status === 'approved';
  const generationApproved = workflow.generationApproval.status === 'approved';

  const statusFor = (id: string) => {
    if (id === 'sentence' || id === 'interview') return hasBrief;
    if (id === 'image-storyboard') return false;
    if (id === 'character') return hasCharacter;
    if (id === 'reference-approval') return creativeApproved;
    if (id === 'storyboard' || id === 'direction' || id === 'prompt-review') return hasStoryboard;
    if (id === 'generation-approval') return generationApproved;
    if (id === 'paid-submit') return false;
    if (id === 'takes' || id === 'timeline' || id === 'render') return mediaCount > 0;
    return false;
  };

  return (
    <aside className="space-y-5" aria-label={`${titleByWorkspace[workspace]} 단계 정보`}>
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-300">현재 단계</p>
        <h2 className="mt-2 text-xl font-black text-white">{titleByWorkspace[workspace]}</h2>
      </div>

      {sampleMode ? <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.08] p-4"><p className="text-sm font-black text-amber-200">샘플 보기 모드</p><p className="mt-2 text-xs leading-5 text-amber-100/70">샘플 자산은 프로젝트 데이터·승인 해시·렌더 대상에 포함되지 않습니다.</p></div> : null}

      <div className="space-y-2">
        {steps.map((step) => {
          const complete = statusFor(step.id);
          return <div key={step.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3"><span className={`h-2.5 w-2.5 rounded-full ${complete ? 'bg-emerald-400' : 'bg-gray-600'}`}/><span className="text-sm font-semibold text-gray-200">{step.label}</span><span className={`ml-auto text-xs font-bold ${complete ? 'text-emerald-300' : 'text-gray-500'}`}>{complete ? '완료' : '대기'}</span></div>;
        })}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-xs leading-5 text-gray-400">
        <p className="font-bold text-gray-200">프로젝트 데이터</p>
        <dl className="mt-3 space-y-2"><div className="flex justify-between"><dt>인터뷰 브리프</dt><dd>{hasBrief ? '있음' : '없음'}</dd></div><div className="flex justify-between"><dt>캐릭터 텍스트</dt><dd>{hasCharacter ? '있음' : '없음'}</dd></div><div className="flex justify-between"><dt>스토리보드</dt><dd>{hasStoryboard ? '있음' : '없음'}</dd></div><div className="flex justify-between"><dt>정식 미디어</dt><dd>{mediaCount}개</dd></div></dl>
      </div>

      <button type="button" onClick={onOpenAdvanced} className="w-full rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-gray-300 hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400">고급 운영 콘솔 열기</button>
      <p className="text-xs leading-5 text-gray-500">JSON·해시·승인·생성 공급자 설정은 운영 콘솔에서만 확인합니다.</p>
    </aside>
  );
}
