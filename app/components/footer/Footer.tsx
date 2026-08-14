'use client';

import Link from 'next/link';
import {usePathname} from 'next/navigation';

export default function Footer() {
  const pathname = usePathname();

  if (pathname.startsWith('/projects/') || pathname.startsWith('/studio-concept')) return null;

  return (
    <footer className="border-t border-white/[0.07] bg-[#08090d]">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-7 text-xs text-gray-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-center gap-3">
          <span className="font-black text-gray-300">ClipJS</span>
          <span className="h-3 w-px bg-white/10" aria-hidden="true" />
          <span>함께봄 주식회사</span>
        </div>
        <div className="flex items-center gap-5">
          <Link href="/about" className="transition-colors hover:text-white">제품 소개</Link>
          <a href="https://aikkumhub.com" target="_blank" rel="noreferrer" className="transition-colors hover:text-white">AI꿈 Hub</a>
          <span className="clip-number">© {new Date().getFullYear()}</span>
        </div>
      </div>
    </footer>
  );
}
