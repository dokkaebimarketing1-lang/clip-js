'use client';

import {useEffect, useState} from 'react';
import type {ProjectState} from '@/app/types';
import type {WorkflowState} from '@/app/lib/workflow/schema';
import {computeRenderInputHash} from '@/app/lib/workflow/approval-v3';

type EditFlowGateProps = {
  project: ProjectState;
  sampleMode: boolean;
};

export default function EditFlowGate({project, sampleMode}: EditFlowGateProps) {
  const workflow: WorkflowState = project.workflow;
  const approvedTakeCount = workflow.production.takes.filter((take) => take.takeApproval.status === 'approved').length;
  const [releaseResult, setReleaseResult] = useState<{project: ProjectState; approved: boolean} | null>(null);
  useEffect(() => {
    let current = true;
    if (sampleMode) return () => { current = false; };
    const approval = project.workflow.releaseApproval;
    if (approval.status !== 'approved' || !approval.renderInputHash) return () => { current = false; };
    void computeRenderInputHash(project).then((hash) => {
      if (current) setReleaseResult({project, approved: hash === approval.renderInputHash});
    }).catch(() => {
      if (current) setReleaseResult({project, approved: false});
    });
    return () => { current = false; };
  }, [project, sampleMode]);
  const releaseApproved = releaseResult?.project === project && releaseResult.approved;
  const tone = sampleMode
    ? 'border-amber-400/25 bg-amber-400/[0.10]'
    : approvedTakeCount
      ? 'border-emerald-400/20 bg-emerald-400/[0.07]'
      : 'border-red-400/20 bg-red-400/[0.07]';
  const titleTone = sampleMode ? 'text-amber-200' : approvedTakeCount ? 'text-emerald-200' : 'text-red-200';

  return (
    <div className={`shrink-0 border-b px-5 py-3 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-sm font-black ${titleTone}`}>
            {sampleMode
              ? 'UI 체험용 편집 화면 · 현재 프로젝트 진행 상태와 무관'
              : approvedTakeCount
                ? `승인 생성본 ${approvedTakeCount}개를 배치할 수 있습니다`
                : '먼저 생성·검수에서 사용할 생성본을 승인하세요'}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {sampleMode
              ? '샘플 미디어와 타임라인은 최종 출력 승인·렌더 대상에 포함되지 않습니다.'
              : approvedTakeCount
                ? `배치·편집 후 최종 출력 승인을 별도로 완료해야 렌더할 수 있습니다. · 최종 출력 ${releaseApproved ? '승인됨' : '미승인'}`
                : '업로드 미디어가 있어도 영상 생성 결과의 승인 생성본을 대신하지 않습니다.'}
          </p>
        </div>
        <div className="flex gap-2 text-[11px] font-bold">
          {sampleMode ? <>
            <span className="rounded-full bg-amber-400/15 px-3 py-1 text-amber-200">읽기 전용</span>
            <span className="rounded-full bg-white/5 px-3 py-1 text-gray-400">저장 안 함</span>
          </> : <>
            <span className={`rounded-full px-3 py-1 ${approvedTakeCount ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/5 text-gray-500'}`}>승인 생성본 {approvedTakeCount}</span>
            <span className={`rounded-full px-3 py-1 ${releaseApproved ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/5 text-gray-500'}`}>최종 출력 {releaseApproved ? '승인' : '대기'}</span>
          </>}
        </div>
      </div>
    </div>
  );
}
