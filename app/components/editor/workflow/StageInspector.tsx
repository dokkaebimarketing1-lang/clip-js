'use client';

import {useEffect, useState} from 'react';
import {getWorkspaceInternalSteps, type ProjectWorkspaceId} from '@/app/lib/editor/project-workspace';
import {deriveStageStepStates, titleByWorkspace, type StageStepState} from '@/app/lib/editor/stage-status';
import type {ProjectState} from '@/app/types';

type StageInspectorProps = {
  workspace: ProjectWorkspaceId;
  project: ProjectState;
  sampleMode: boolean;
  hasSubmittedGeneration: boolean;
  onOpenAdvanced: () => void;
};

export default function StageInspector({workspace, project, sampleMode, hasSubmittedGeneration, onOpenAdvanced}: StageInspectorProps) {
  const workflow = project.workflow;
  const steps = getWorkspaceInternalSteps(workspace);
  const [result, setResult] = useState<{
    project: ProjectState;
    workspace: ProjectWorkspaceId;
    hasSubmittedGeneration: boolean;
    states: Record<string, StageStepState>;
  } | null>(null);
  useEffect(() => {
    let current = true;
    void deriveStageStepStates({workspace, project, hasSubmittedGeneration}).then((next) => {
      if (current) setResult({project, workspace, hasSubmittedGeneration, states: next});
    });
    return () => { current = false; };
  }, [hasSubmittedGeneration, project, workspace]);
  const states = result?.project === project
    && result.workspace === workspace
    && result.hasSubmittedGeneration === hasSubmittedGeneration
    ? result.states
    : null;
  const hasBrief = Boolean(workflow.interviewBrief);
  const characterCount = workflow.characterSheets?.length ?? (workflow.characterSheet ? 1 : 0);
  const hasStoryboard = Boolean(workflow.storyboard);

  return (
    <aside className="space-y-5" aria-label={`${titleByWorkspace[workspace]} 단계 정보`}>
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-300">현재 단계</p>
        <h2 className="mt-2 text-xl font-black text-white">{titleByWorkspace[workspace]}</h2>
      </div>

      {sampleMode ? <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.08] p-4"><p className="text-sm font-black text-amber-200">샘플 보기 모드</p><p className="mt-2 text-xs leading-5 text-amber-100/70">샘플 자산은 프로젝트 데이터·승인 해시·렌더 대상에 포함되지 않습니다.</p></div> : null}

      <div className="space-y-2">
        {steps.map((step) => {
          const state = states?.[step.id];
          return <div key={step.id} className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${state === 'current' ? 'border-fuchsia-400/35 bg-fuchsia-400/[0.08]' : 'border-white/10 bg-white/[0.025]'}`}><span className={`h-2.5 w-2.5 rounded-full ${state === 'complete' ? 'bg-emerald-400' : state === 'current' ? 'bg-fuchsia-400 shadow-[0_0_10px_#e879f9]' : 'bg-gray-700'}`}/><span className="text-sm font-semibold text-gray-200">{step.label}</span><span className={`ml-auto text-xs font-bold ${state === 'complete' ? 'text-emerald-300' : state === 'current' ? 'text-fuchsia-200' : 'text-gray-600'}`}>{!states ? '확인 중' : state === 'complete' ? '완료' : state === 'current' ? '지금 할 일' : '이후'}</span></div>;
        })}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-xs leading-5 text-gray-400">
        <p className="font-bold text-gray-200">프로젝트 데이터</p>
        <dl className="mt-3 space-y-2"><div className="flex justify-between"><dt>기획 초안</dt><dd>{hasBrief ? '있음' : '없음'}</dd></div><div className="flex justify-between"><dt>캐릭터</dt><dd>{characterCount}명</dd></div><div className="flex justify-between"><dt>콘티</dt><dd>{hasStoryboard ? '있음' : '없음'}</dd></div><div className="flex justify-between"><dt>승인된 Take</dt><dd>{workflow.production.takes.filter((take) => take.takeApproval.status === 'approved').length}개</dd></div></dl>
      </div>

      <button type="button" disabled={sampleMode} onClick={onOpenAdvanced} className="w-full rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-gray-300 hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:cursor-not-allowed disabled:text-gray-600 disabled:hover:border-white/15">
        {sampleMode ? '샘플에서는 실행할 수 없습니다' : workspace === 'generation' ? '사양·비용 확인하고 생성 실행' : '고급 운영 콘솔 열기'}
      </button>
      <p className="text-xs leading-5 text-gray-500">{workspace === 'generation' ? '실제 견적과 생성 실행 승인을 확인한 뒤 제출하고, 생성 상태는 실행 화면에서 따로 확인합니다.' : 'JSON·해시·승인·생성 공급자 설정은 운영 콘솔에서만 확인합니다.'}</p>
    </aside>
  );
}
