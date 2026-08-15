'use client';

import {FileText, Send, Sparkles, WandSparkles} from 'lucide-react';
import {useMemo, useState} from 'react';
import type {FormEventHandler, KeyboardEvent} from 'react';

const QUESTIONS = [
  {
    id: 'concept',
    question: '어떤 주인공이나 소재로, 어떤 영상을 만들고 싶으세요?',
    acknowledgement: '영상의 중심이 되는 주제와 콘셉트를 정했어요.',
    placeholder: '예: 크림색 시바견이 산책을 준비하는 브랜드 필름',
    choices: ['캐릭터가 이끄는 짧은 이야기', '제품을 소개하는 브랜드 필름', '일상을 담은 브이로그', '서비스를 설명하는 안내 영상'],
  },
  {
    id: 'tone',
    question: '영상은 어떤 분위기와 톤으로 기억되면 좋을까요?',
    acknowledgement: '좋아요. 전체 장면이 같은 감정선으로 이어지게 할게요.',
    placeholder: '예: 따뜻하고 진솔하게, 자연광 중심으로',
    choices: ['따뜻하고 진솔하게', '밝고 경쾌하게', '차분하고 감성적으로', '세련되고 시네마틱하게'],
  },
  {
    id: 'format',
    question: '마지막으로 영상 길이와 화면비를 골라 주세요.',
    acknowledgement: '필요한 내용이 모두 모였어요. 현재 기획을 확인하고 인터뷰를 끝내 주세요.',
    placeholder: '예: 30초, 1:1 정사각형',
    choices: ['20초 · 16:9 가로', '20초 · 9:16 세로', '30초 · 16:9 가로', '30초 · 9:16 세로'],
  },
] as const;

type QuestionId = typeof QUESTIONS[number]['id'];
type PlanningAnswers = Partial<Record<QuestionId, string>>;

type PlanningInterviewProps = {
  readonly sentence: string;
  readonly isComposing: boolean;
  readonly composeError: string | null;
  readonly onSentenceChange: (sentence: string) => void;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
};

export function buildPlanningSentence(answers: PlanningAnswers): string {
  const parts = [
    answers.concept ? `주제와 콘셉트는 "${answers.concept}"입니다.` : '',
    answers.tone ? `영상 분위기는 "${answers.tone}"으로 연출해 주세요.` : '',
    answers.format ? `길이와 화면비는 "${answers.format}"로 제작해 주세요.` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

function AiMessage({questionIndex, showChoices, onAnswer, disabled}: {
  readonly questionIndex: number;
  readonly showChoices: boolean;
  readonly onAnswer: (answer: string) => void;
  readonly disabled: boolean;
}) {
  const question = QUESTIONS[questionIndex];
  if (!question) return null;
  return (
    <div className="flex items-start gap-2 sm:gap-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-fuchsia-400/25 bg-fuchsia-500/[0.12] text-fuchsia-200 sm:h-9 sm:w-9 sm:rounded-xl">
        <Sparkles aria-hidden="true" className="h-4 w-4"/>
      </div>
      <div className="min-w-0 max-w-2xl">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold text-gray-500">
          <span className="text-fuchsia-200">AI 제작 매니저</span><span>기획 인터뷰</span>
        </div>
        <div className="mt-2 rounded-2xl rounded-tl-md border border-white/10 bg-white/[0.045] p-3 sm:p-5">
          <p className="break-keep text-sm leading-6 text-gray-200">
            {questionIndex === 0 ? '반가워요. 아이디어를 제작 가능한 기획으로 함께 정리해 볼게요.' : QUESTIONS[questionIndex - 1]?.acknowledgement}
          </p>
          <p className="mt-3 break-keep text-sm font-black leading-6 text-white sm:text-base sm:leading-7">{question.question}</p>
          {showChoices ? <div className="mt-4 flex flex-wrap gap-2" aria-label="빠른 답변">
            {question.choices.map((choice) => <button key={choice} type="button" disabled={disabled} onClick={() => onAnswer(choice)} className="w-full rounded-xl border border-white/15 bg-black/20 px-3.5 py-2 text-left text-xs font-bold text-gray-200 transition-colors hover:border-fuchsia-400/50 hover:bg-fuchsia-500/[0.10] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto">{choice}</button>)}
          </div> : null}
        </div>
      </div>
    </div>
  );
}

export default function PlanningInterview({sentence, isComposing, composeError, onSentenceChange, onSubmit}: PlanningInterviewProps) {
  const [answers, setAnswers] = useState<PlanningAnswers>({});
  const [draft, setDraft] = useState('');
  const answeredCount = QUESTIONS.filter((question) => Boolean(answers[question.id])).length;
  const currentQuestionIndex = answeredCount;
  const currentQuestion = QUESTIONS[currentQuestionIndex];
  const formatSummary = useMemo(() => {
    const format = answers.format ?? '';
    return {
      duration: format.match(/\d+\s*초|\d+\s*분/)?.[0] ?? (format || '아직 미정'),
      aspectRatio: format.match(/\d+\s*:\s*\d+|가로형|세로형|정사각형/)?.[0] ?? (format ? '답변에 포함' : '아직 미정'),
    };
  }, [answers.format]);

  const answerCurrentQuestion = (answer: string) => {
    const value = answer.trim();
    if (!currentQuestion || !value || isComposing) return;
    const nextAnswers = {...answers, [currentQuestion.id]: value};
    setAnswers(nextAnswers);
    setDraft('');
    onSentenceChange(buildPlanningSentence(nextAnswers));
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      answerCurrentQuestion(draft);
    }
  };

  return (
    <form onSubmit={onSubmit} className="max-w-4xl">
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#17151d] shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
        <div className="border-b border-white/10 bg-white/[0.025] px-3 py-4 sm:px-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/20 bg-fuchsia-500/[0.08] px-3 py-1.5 text-xs font-black text-fuchsia-200"><WandSparkles aria-hidden="true" className="h-3.5 w-3.5"/>AI 제작 매니저</span>
          <p className="mt-3 break-keep text-sm leading-6 text-gray-400">선택지를 고르거나 직접 답해 주세요. 답변은 브라우저 안에서만 모은 뒤 한 번에 기획 AI로 전달합니다.</p>
        </div>

        <div role="log" aria-live="polite" aria-label="기획 인터뷰 대화" className="space-y-6 px-3 py-5 sm:px-6 sm:py-6">
          <AiMessage questionIndex={0} showChoices={currentQuestionIndex === 0} onAnswer={answerCurrentQuestion} disabled={isComposing}/>
          {QUESTIONS.map((question, index) => {
            const answer = answers[question.id];
            if (!answer) return null;
            const nextQuestionIndex = index + 1;
            return <div key={question.id} className="space-y-6">
              <div className="flex items-start justify-end gap-2 sm:gap-3">
                <div className="max-w-2xl break-keep rounded-2xl rounded-tr-md bg-fuchsia-500 px-3 py-2.5 text-sm font-bold leading-6 text-white shadow-[0_10px_30px_rgba(217,70,239,0.16)] sm:px-4 sm:py-3">{answer}</div>
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.06] text-xs font-black text-gray-200 sm:h-9 sm:w-9 sm:rounded-xl">나</div>
              </div>
              {nextQuestionIndex < QUESTIONS.length ? <AiMessage questionIndex={nextQuestionIndex} showChoices={currentQuestionIndex === nextQuestionIndex} onAnswer={answerCurrentQuestion} disabled={isComposing}/> : <div className="flex items-start gap-2 sm:gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-fuchsia-400/25 bg-fuchsia-500/[0.12] text-fuchsia-200 sm:h-9 sm:w-9 sm:rounded-xl"><Sparkles aria-hidden="true" className="h-4 w-4"/></div><div className="max-w-2xl break-keep rounded-2xl rounded-tl-md border border-fuchsia-400/20 bg-fuchsia-500/[0.07] p-3 text-sm font-bold leading-6 text-fuchsia-100 sm:p-4">{question.acknowledgement}</div></div>}
            </div>;
          })}
        </div>

        <section className="mx-3 mb-3 rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/[0.055] p-4 sm:mx-6 sm:mb-5 sm:p-5" aria-labelledby="current-planning-title">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="current-planning-title" className="flex items-center gap-2 text-sm font-black text-white"><FileText aria-hidden="true" className="h-4 w-4 text-fuchsia-300"/>현재 기획</h2><span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-3 py-1 text-[11px] font-black text-fuchsia-200">{answeredCount}개 항목 확정</span></div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {[['주제·콘셉트', answers.concept ?? '아직 미정'], ['분위기', answers.tone ?? '아직 미정'], ['길이', formatSummary.duration], ['화면비', formatSummary.aspectRatio]].map(([label, value]) => <div key={label} className="rounded-xl border border-white/[0.07] bg-black/20 px-4 py-3"><dt className="text-[10px] font-bold text-gray-500">{label}</dt><dd className={`mt-1 text-sm font-black ${value === '아직 미정' ? 'text-gray-600' : 'text-gray-200'}`}>{value}</dd></div>)}
          </dl>
        </section>

        <div className="sticky bottom-0 border-t border-white/10 bg-[#17151d]/95 p-3 backdrop-blur sm:p-5">
          {currentQuestion ? <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <label htmlFor="planning-answer" className="sr-only">{currentQuestion.question} 직접 답변</label>
            <textarea id="planning-answer" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleComposerKeyDown} rows={2} placeholder={currentQuestion.placeholder} disabled={isComposing} className="w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-white placeholder:text-gray-600 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"/>
            <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-3"><p className="text-[11px] text-gray-600">Ctrl/⌘ + Enter로 답변 전송</p><button type="button" onClick={() => answerCurrentQuestion(draft)} disabled={!draft.trim() || isComposing} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-black text-black hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300 disabled:cursor-not-allowed disabled:opacity-40">답변 보내기<Send aria-hidden="true" className="h-3.5 w-3.5"/></button></div>
          </div> : null}
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p aria-live="polite" className={`text-xs ${composeError ? 'text-red-300' : isComposing ? 'text-fuchsia-200' : 'text-gray-500'}`}>{composeError ?? (isComposing ? '요청 제출 완료 · AI가 기획 산출물을 만들고 있습니다…' : currentQuestion ? '세 가지 답변이 모이면 인터뷰를 끝낼 수 있어요.' : '답변을 한 문장으로 정리했습니다. 이제 기획 초안을 만들 수 있어요.')}</p>
            <button type="submit" disabled={!sentence.trim() || currentQuestionIndex < QUESTIONS.length || isComposing} className="shrink-0 rounded-xl bg-fuchsia-500 px-5 py-2.5 text-sm font-black text-white hover:bg-fuchsia-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300 disabled:cursor-not-allowed disabled:opacity-40">{isComposing ? '기획 작업 중…' : '인터뷰 끝내기 →'}</button>
          </div>
        </div>
      </div>
    </form>
  );
}
