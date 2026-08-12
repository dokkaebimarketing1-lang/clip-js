'use client';

import Image from 'next/image';

export const MOCK_ASSETS = [
  {kind: 'image', label: '마스터 시트', src: '/mock-assets/reference-shiba.webp'},
  {kind: 'image', label: '장면 01', src: '/mock-assets/story-01.webp'},
  {kind: 'image', label: '장면 02', src: '/mock-assets/story-02.webp'},
  {kind: 'video', label: '샘플 영상', src: '/mock-assets/sample-video-web.mp4'},
] as const;

export function MockMediaList() {
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/5 px-3 py-2 text-[10px] leading-4 text-fuchsia-200">내 컴퓨터에서 가져온 목업용 실제 자산입니다.</div>
      <div className="grid grid-cols-2 gap-2">
        {MOCK_ASSETS.map((asset) => (
          <article key={asset.src} className="overflow-hidden rounded-lg border border-white/10 bg-black/30">
            <div className="relative aspect-video bg-black">
              {asset.kind === 'image' ? <Image src={asset.src} alt={asset.label} fill className="object-cover" sizes="120px"/> : <video src={asset.src} poster="/mock-assets/video-poster.webp" muted playsInline preload="metadata" className="h-full w-full object-cover"/>}
            </div>
            <div className="truncate px-2 py-1.5 text-[10px] font-semibold text-gray-300">{asset.label}</div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function MockPreviewPlayer() {
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-black p-4">
      <video src="/mock-assets/sample-video-web.mp4" poster="/mock-assets/video-poster.webp" controls muted playsInline preload="metadata" className="max-h-full max-w-full rounded-lg border border-white/10 shadow-2xl"/>
      <span className="pointer-events-none absolute left-6 top-6 rounded-full border border-white/15 bg-black/70 px-3 py-1 text-[10px] font-bold text-white backdrop-blur">목업 · 로컬 실제 영상</span>
    </div>
  );
}
