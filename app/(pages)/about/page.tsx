import Link from 'next/link';
import {FiArrowRight, FiCheckCircle, FiExternalLink, FiLock, FiUsers} from 'react-icons/fi';

const values = [
  {icon: FiUsers, title: '사용자가 최종 결정합니다', body: 'AI 결과는 검토 가능한 초안입니다. 기획 필드, 기준 이미지, 콘티, 생성본을 사용자가 직접 수정하고 승인합니다.'},
  {icon: FiCheckCircle, title: '현재 상태와 정확히 일치해야 합니다', body: '오래된 승인이나 이전 자산이 다음 단계를 열지 않도록 현재 프로젝트 입력과 승인 계보를 대조합니다.'},
  {icon: FiLock, title: '유료 실행은 명시적으로 분리합니다', body: '사양·실제 견적·변경 영향을 확인한 뒤 별도로 승인해야 provider 제출을 시작할 수 있습니다.'},
] as const;

export default function AboutPage() {
  return (
    <main className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[540px] bg-[radial-gradient(circle_at_50%_0%,rgba(217,70,239,.16),transparent_42%)]" />
      <section className="relative mx-auto max-w-5xl px-5 pb-16 pt-24 text-center sm:px-8 sm:pt-32">
        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-fuchsia-300">Built by Hamkkebom</p>
        <h1 className="mx-auto mt-5 max-w-4xl text-balance text-4xl font-black leading-tight tracking-[-0.04em] text-white sm:text-5xl">사람이 결정할 수 있는<br />AI 영상 제작 도구를 만듭니다.</h1>
        <p className="mx-auto mt-7 max-w-2xl text-base leading-8 text-gray-400 sm:text-lg">ClipJS는 함께봄 주식회사가 만드는 AI 영상 제작 스튜디오입니다. 빠른 생성보다 제작자가 결과를 이해하고, 비교하고, 자신의 손으로 확정할 수 있는 흐름을 우선합니다.</p>
        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row"><Link href="/projects" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 text-sm font-black text-gray-950 hover:bg-fuchsia-50">프로젝트 시작하기 <FiArrowRight aria-hidden="true" /></Link><a href="https://aikkumhub.com" target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-6 text-sm font-bold text-gray-200 hover:bg-white/[0.07]">AI꿈 Hub <FiExternalLink aria-hidden="true" /></a></div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:px-10">
        <div className="grid gap-4 lg:grid-cols-3">
          {values.map(({icon: Icon, title, body}, index) => <article key={title} className="clip-panel p-7"><div className="flex items-center justify-between"><span className="grid h-12 w-12 place-items-center rounded-2xl border border-fuchsia-400/20 bg-fuchsia-400/[0.07] text-fuchsia-300"><Icon size={20} aria-hidden="true" /></span><span className="text-[10px] font-black tracking-[0.2em] text-gray-700">0{index + 1}</span></div><h2 className="mt-7 text-xl font-black text-white">{title}</h2><p className="mt-4 text-sm leading-7 text-gray-500">{body}</p></article>)}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-24 sm:px-8 lg:px-10">
        <div className="overflow-hidden rounded-[28px] border border-white/[0.08] bg-gradient-to-br from-[#17121c] to-[#101119] p-8 sm:p-12">
          <div className="grid gap-10 lg:grid-cols-[1fr_.9fr] lg:items-center">
            <div><p className="text-[11px] font-black uppercase tracking-[0.22em] text-violet-300">Production protocol</p><h2 className="mt-4 text-3xl font-black tracking-tight text-white">결정 → 실행 → 검수의 경계를 분명하게</h2><p className="mt-5 max-w-xl text-sm leading-7 text-gray-400">현재 대상과 결과를 확인하고, 비용과 변경 영향을 이해한 뒤 명시적으로 실행합니다. 비동기 작업은 저장 상태를 보여 주고, 도착한 결과는 승인·반려·재시도 과정을 거쳐 다음 단계로 이동합니다.</p></div>
            <ol className="space-y-3 text-sm font-semibold text-gray-300">
              {['현재 대상·결과 확인', '사용자 수정·결정', '비용과 변경 영향 확인', '명시 실행과 진행 상태 확인', '결과 검수·승인 또는 반려'].map((item, index) => <li key={item} className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-black/15 px-4 py-3"><span className="text-[10px] font-black text-fuchsia-300">0{index + 1}</span>{item}</li>)}
            </ol>
          </div>
        </div>
      </section>
    </main>
  );
}
