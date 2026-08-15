'use client';

import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {FiArrowUpRight} from 'react-icons/fi';

const links = [
    {href: '/', label: '홈'},
    {href: '/projects', label: '프로젝트'},
    {href: '/about', label: '소개'},
];

export default function Header() {
    const pathname = usePathname();

    if (pathname.startsWith('/projects/') || pathname.startsWith('/studio-concept')) return null;

    return (
        <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#08090d]/85 backdrop-blur-xl">
            <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-5 sm:px-8">
                <Link href="/" className="group flex items-center gap-3" aria-label="함께봄 Ai영상제작소 홈">
                    <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-600 text-sm font-black text-white shadow-[0_0_28px_rgba(217,70,239,.25)] transition-transform group-hover:scale-105">봄</span>
                    <span className="text-[15px] font-black tracking-[-0.03em] text-white">함께봄 Ai영상제작소</span>
                    <span className="hidden rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[9px] font-bold tracking-[0.14em] text-gray-500 sm:inline">AI STUDIO</span>
                </Link>

                <nav aria-label="주요 메뉴" className="ml-auto flex items-center gap-1">
                    {links.map((link) => {
                        const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                aria-current={active ? 'page' : undefined}
                                className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${active ? 'bg-white/[0.08] text-white' : 'text-gray-400 hover:bg-white/[0.05] hover:text-white'}`}
                            >
                                {link.label}
                            </Link>
                        );
                    })}
                </nav>

                <Link href="/projects" className="hidden items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-extrabold text-black transition-colors hover:bg-fuchsia-100 sm:flex">
                    스튜디오 열기 <FiArrowUpRight aria-hidden="true" />
                </Link>
            </div>
        </header>
    );
}
