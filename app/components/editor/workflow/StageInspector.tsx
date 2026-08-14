'use client';

import {useEffect, useState} from 'react';
import {FiArrowUpRight, FiCheck, FiCircle} from 'react-icons/fi';
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
    if (sampleMode) return;
    let current = true;
    void deriveStageStepStates({workspace, project, hasSubmittedGeneration}).then((next) => {
      if (current) setResult({project, workspace, hasSubmittedGeneration, states: next});
    });
    return () => { current = false; };
  }, [hasSubmittedGeneration, project, sampleMode, workspace]);

  const sampleStates = Object.fromEntries(steps.map((step, index) => [step.id, index === 0 ? 'current' : 'pending'])) as Record<string, StageStepState>;
  const states = sampleMode ? sampleStates : result?.project === project && result.workspace === workspace && result.hasSubmittedGeneration === hasSubmittedGeneration ? result.states : null;
  const completeCount = states ? steps.filter((step) => states[step.id] === 'complete').length : 0;
  const hasBrief = Boolean(workflow.interviewBrief);
  const characterCount = workflow.characterSheets?.length ?? (workflow.characterSheet ? 1 : 0);
  const hasStoryboard = Boolean(workflow.storyboard);
  const approvedTakeCount = workflow.production.takes.filter((take) => take.takeApproval.status === 'approved').length;

  return (
    <aside className="space-y-6" aria-label={`${titleByWorkspace[workspace]} 단계 정보`}>
      <header className="border-b border-white/[0.08] pb-5">
        <div className="flex items-center justify-between gap-3">
          <p className="clip-eyebrow">현재 단계</p>
          <span className="clip-number rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[10px] font-bold text-gray-500">{states ? `${completeCount}/${steps.length}` : '확인 중…'}</span>
        </div>
        <h2 className="clip-title mt-3 text-2xl font-black text-white">{titleByWorkspace[workspace]}</h2>
        <p className="mt-2 text-xs leading-5 text-gray-500">아래 순서대로 확인하면 이 단계를 안전하게 마칠 수 있습니다.</p>
      </header>

      {sampleMode ? <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.07] p-4"><p className="text-sm font-black text-amber-200">샘플 보기 모드</p><p className="mt-2 text-xs leading-5 text-amber-100/65">샘플 자산은 프로젝트 데이터·승인 해시·렌더 대상에 포함되지 않습니다.</p></div> : null}

      <ol className="relative space-y-1">
        {steps.map((step, index) => {
          const state = states?.[step.id];
          const complete = state === 'complete';
          const current = state === 'current';
          return (
            <li key={step.id} className={`relative flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors ${current ? 'border-fuchsia-400/25 bg-fuchsia-400/[0.075]' : 'border-transparent bg-transparent'}`}>
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border text-[10px] font-black ${complete ? 'border-emerald-400/20 bg-emerald-400/[0.1] text-emerald-300' : current ? 'border-fuchsia-400/25 bg-fuchsia-400/[0.12] text-fuchsia-200' : 'border-white/[0.08] bg-white/[0.025] text-gray-600'}`}>{complete ? <FiCheck aria-hidden="true" /> : current ? <FiCircle className="h-2.5 w-2.5 fill-current" aria-hidden="true" /> : index + 1}</span>
              <span className={`min-w-0 flex-1 text-xs font-bold ${current ? 'text-white' : complete ? 'text-gray-300' : 'text-gray-600'}`}>{step.label}</span>
              <span className={`text-[10px] font-bold ${complete ? 'text-emerald-400' : current ? 'text-fuchsia-300' : 'text-gray-700'}`}>{!states ? '…' : complete ? '완료' : current ? '진행' : '대기'}</span>
            </li>
          );
        })}
      </ol>

      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4" aria-labelledby="project-data-title">
        <h3 id="project-data-title" className="text-xs font-extrabold text-gray-300">{sampleMode ? '샘플 현황' : '프로젝트 현황'}</h3>
        {sampleMode ? <p className="mt-4 text-xs leading-5 text-gray-500">예시 자산만 표시합니다. 실제 프로젝트의 기획·캐릭터·콘티·승인 수는 샘플 화면에 노출하지 않습니다.</p> : <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
          <div><dt className="text-[10px] text-gray-600">기획 초안</dt><dd className="mt-1 text-sm font-black text-gray-200">{hasBrief ? '준비됨' : '없음'}</dd></div>
          <div><dt className="text-[10px] text-gray-600">캐릭터</dt><dd className="clip-number mt-1 text-sm font-black text-gray-200">{characterCount}명</dd></div>
          <div><dt className="text-[10px] text-gray-600">콘티</dt><dd className="mt-1 text-sm font-black text-gray-200">{hasStoryboard ? '준비됨' : '없음'}</dd></div>
          <div><dt className="text-[10px] text-gray-600">승인 Take</dt><dd className="clip-number mt-1 text-sm font-black text-gray-200">{approvedTakeCount}개</dd></div>
        </dl>}
      </section>

      <div>
        <button type="button" disabled={sampleMode} onClick={onOpenAdvanced} className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.035] px-4 py-3 text-sm font-extrabold text-gray-200 transition-[border-color,background-color,color] hover:border-fuchsia-400/30 hover:bg-fuchsia-400/[0.07] hover:text-white disabled:cursor-not-allowed disabled:text-gray-600 disabled:hover:border-white/15 disabled:hover:bg-white/[0.035]">
          {sampleMode ? '샘플에서는 실행할 수 없습니다' : workspace === 'generation' ? '사양·비용 확인하고 생성 실행' : '고급 운영 콘솔 열기'}
          {!sampleMode ? <FiArrowUpRight aria-hidden="true" /> : null}
        </button>
        <p className="mt-3 text-[11px] leading-5 text-gray-600">{workspace === 'generation' ? '실제 견적과 실행 승인을 확인한 뒤 제출합니다.' : 'JSON·해시·공급자 설정은 고급 운영 콘솔에만 표시합니다.'}</p>
      </div>
    </aside>
  );
}
