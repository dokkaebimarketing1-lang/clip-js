import Image from 'next/image';
import Link from 'next/link';
import {FiArrowRight, FiCheck, FiLock, FiPlayCircle, FiZap} from 'react-icons/fi';

const workflow = [
  ['01', '기획', '아이디어를 AI 브리프로 정리하고 직접 수정·확정합니다.'],
  ['02', '캐릭터·스타일', '기준 이미지와 Style Bible로 공통 화풍을 고정합니다.'],
  ['03', '콘티·승인', '컷과 샷을 비교·수정하고 전체 콘티를 승인합니다.'],
  ['04', '생성·검수', '사양과 실제 견적 확인 후 생성본을 승인·반려합니다.'],
  ['05', '편집·출력', '승인된 Take만 타임라인에 연결하고 최종 출력합니다.'],
] as const;

export default function Home() {
  return (
    <main className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[700px] bg-[radial-gradient(circle_at_72%_18%,rgba(217,70,239,.18),transparent_28%),radial-gradient(circle_at_25%_10%,rgba(124,58,237,.12),transparent_24%)]" />
      <section className="relative mx-auto grid min-h-[680px] max-w-7xl items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1.04fr_.96fr] lg:px-10">
        <div><p className="text-[11px] font-black uppercase tracking-[0.24em] text-fuchsia-300">Decision-led AI production</p><h1 className="mt-6 max-w-3xl text-balance text-5xl font-black leading-[1.04] tracking-[-0.05em] text-white sm:text-6xl lg:text-6xl">아이디어를 결정하면,<br /><span className="bg-gradient-to-r from-fuchsia-300 via-white to-violet-300 bg-clip-text text-transparent">제작의 다음 단계가 보입니다.</span></h1><p className="mt-7 max-w-2xl text-base leading-8 text-gray-400 sm:text-lg">기획부터 캐릭터, 콘티, 생성, 편집까지. AI 초안을 직접 확인하고 수정·승인하며 결과를 완성하는 영상 제작 스튜디오입니다.</p><div className="mt-9 flex flex-col gap-3 sm:flex-row"><Link href="/projects" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 text-sm font-black text-gray-950 hover:bg-fuchsia-50">프로젝트 시작하기 <FiArrowRight aria-hidden="true" /></Link><Link href="/about" className="inline-flex h-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-6 text-sm font-bold text-gray-200 hover:bg-white/[0.07]">제작 원칙 보기</Link></div><div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-xs font-semibold text-gray-500"><span className="flex items-center gap-2"><FiCheck className="text-emerald-400" />사용자 최종 승인</span><span className="flex items-center gap-2"><FiCheck className="text-emerald-400" />프로젝트 상태 저장</span><span className="flex items-center gap-2"><FiLock className="text-amber-400" />비용 확인 전 실행 잠금</span></div></div>
        <div className="relative mx-auto w-full max-w-[560px]"><div className="absolute -inset-8 rounded-full bg-fuchsia-500/10 blur-3xl" /><div className="clip-panel relative overflow-hidden p-5 shadow-[0_40px_100px_rgba(0,0,0,.45)] sm:p-7"><div className="flex items-center justify-between border-b border-white/[0.07] pb-5"><div><p className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-600">Production map</p><p className="mt-2 font-black text-white">브랜드 필름 · 20초</p></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-1 text-[10px] font-black text-emerald-300">자동 저장</span></div><div className="mt-5 space-y-2">{workflow.map(([step, title], index) => <div key={step} className={`flex items-center gap-4 rounded-xl border px-4 py-3 ${index === 2 ? 'border-fuchsia-400/30 bg-fuchsia-400/[0.07]' : 'border-white/[0.06] bg-white/[0.025]'}`}><span className={`grid h-8 w-8 place-items-center rounded-lg text-[10px] font-black ${index < 2 ? 'bg-emerald-400/10 text-emerald-300' : index === 2 ? 'bg-fuchsia-500 text-white' : 'bg-white/[0.05] text-gray-600'}`}>{index < 2 ? <FiCheck /> : step}</span><div className="min-w-0 flex-1"><p className={`text-sm font-bold ${index <= 2 ? 'text-gray-200' : 'text-gray-600'}`}>{title}</p><p className="mt-0.5 text-[10px] text-gray-600">{index < 2 ? '사용자 승인 완료' : index === 2 ? '현재 검수 단계' : '이전 단계 완료 후 시작'}</p></div>{index === 2 ? <FiPlayCircle className="text-fuchsia-300" /> : null}</div>)}</div></div></div>
      </section>
      <section aria-labelledby="studio-preview-title" className="relative mx-auto max-w-7xl px-5 pb-24 sm:px-8 lg:px-10">
        <div className="pointer-events-none absolute inset-x-20 bottom-20 top-10 rounded-full bg-fuchsia-500/[0.08] blur-3xl" aria-hidden="true" />
        <div className="relative">
          <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-fuchsia-300">Inside the studio</p>
              <h2 id="studio-preview-title" className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl">실제 제작 화면을 먼저 확인해 보세요</h2>
            </div>
            <p className="max-w-md text-xs leading-6 text-gray-400 lg:text-right">5단계 제작 흐름과 미리보기, 타임라인, 단계별 도구가 한 화면에서 이어집니다.</p>
          </div>
          <figure className="clip-panel overflow-hidden rounded-3xl p-2 shadow-[0_40px_120px_rgba(0,0,0,.5)] sm:p-3">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
              <Image
                src="/landing/editor-preview.png"
                alt="시바견 영상 미리보기와 미디어·타임라인·출력 단계를 보여주는 다크 테마 AI 영상 편집기 화면"
                width={1440}
                height={800}
                sizes="(min-width: 1280px) 1200px, (min-width: 640px) calc(100vw - 4rem), calc(100vw - 2.5rem)"
                className="h-auto w-full"
              />
            </div>
            <figcaption className="px-3 pb-1 pt-3 text-xs leading-5 text-gray-400 sm:px-4">실제 함께봄 Ai영상제작소 편집 화면 · 샘플 프로젝트에서는 업로드 없이 읽기 전용으로 둘러볼 수 있습니다.</figcaption>
          </figure>
        </div>
      </section>
      <section className="border-y border-white/[0.06] bg-white/[0.018]"><div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10"><div className="max-w-2xl"><p className="text-[11px] font-black uppercase tracking-[0.22em] text-violet-300">One production flow</p><h2 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-4xl">무엇을 해야 하는지 잃지 않는 5단계</h2><p className="mt-4 text-sm leading-7 text-gray-500">각 단계는 현재 입력과 승인 상태가 정확히 일치할 때만 다음 작업을 엽니다.</p></div><div className="mt-10 grid gap-3 md:grid-cols-5">{workflow.map(([step,title,body]) => <article key={step} className="clip-panel p-5"><span className="text-[10px] font-black tracking-[0.18em] text-fuchsia-400">{step}</span><h3 className="mt-5 text-base font-black text-white">{title}</h3><p className="mt-3 text-xs leading-6 text-gray-500">{body}</p></article>)}</div></div></section>
      <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10"><div className="grid gap-4 lg:grid-cols-3">{[[FiZap,'초안은 빠르게','한 문장 아이디어를 편집 가능한 기획 초안으로 정리합니다.'],[FiCheck,'결정은 직접','필드·캐릭터·컷·Take를 직접 확인하고 승인하거나 반려합니다.'],[FiLock,'유료 실행은 안전하게','사양과 실제 견적이 준비되지 않으면 provider 제출을 잠급니다.']].map(([Icon,title,body]) => {const CardIcon=Icon as typeof FiZap; return <article key={title as string} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-7"><CardIcon className="text-fuchsia-300" size={20} /><h3 className="mt-6 text-lg font-black text-white">{title as string}</h3><p className="mt-3 text-sm leading-7 text-gray-500">{body as string}</p></article>})}</div></section>
    </main>
  );
}
