"use client";

import {useRef, useState} from 'react';
import toast from 'react-hot-toast';
import {useAppDispatch} from '@/app/store';
import {setWorkflow} from '@/app/store/slices/projectSlice';
import {storyboardSchema, interviewBriefSchema, characterSheetSchema} from '@/app/lib/workflow/schema';

/**
 * 왼쪽 소스 패널의 VLOG 탭용 경량 컴포저.
 * 문장 입력 → 8단계 컴포즈 → 워크플로우에 주입. 결과 미리보기는 오른쪽 설정창에서 확인.
 */
export default function VlogComposerCompact() {
  const sentenceRef = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const dispatch = useAppDispatch();

  const compose = async () => {
    const sentence = sentenceRef.current?.value?.trim() ?? '';
    if (!sentence) {
      toast.error('한 문장을 입력하세요.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/vlog/compose', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({sentence}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error((data as {error?: string}).error ?? 'compose failed');
        return;
      }
      const storyboard = storyboardSchema.parse(data.storyboard);
      const characterSheet = characterSheetSchema.parse(data.characterSheet);
      dispatch(setWorkflow({
        interviewBrief: interviewBriefSchema.parse(data.interviewBrief),
        characterSheet,
        storyboard,
      } as never));
      toast.success('8단계 컴포즈 완료! 오른쪽 설정창 → 워크플로우에서 확인하세요.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'compose failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <textarea
        ref={sentenceRef}
        defaultValue=""
        placeholder="예: 고양이와 인사하는 30초 VLOG 만들어줘"
        className="min-h-24 w-full rounded-lg border border-white/10 bg-black/40 p-2 text-sm text-white placeholder:text-gray-500"
      />
      <button
        onClick={() => void compose()}
        disabled={busy}
        className="w-full rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:opacity-50"
      >
        {busy ? '컴포즈 중…' : '⚡ 8단계 컴포즈'}
      </button>
    </div>
  );
}
