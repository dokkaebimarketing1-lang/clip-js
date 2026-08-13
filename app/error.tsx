"use client";
import { startTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function Error({ error, reset }: { error: Error, reset: () => void }) {
    const router = useRouter();
    const Reload = () => {
        startTransition(() => {
            router.refresh();
            reset();
        })
    }
    console.log(error);
    return (
        <div className="flex flex-col items-center justify-center h-screen">
            <p className='text-3xl font-semibold text-center'>문제가 발생했습니다.</p>
            <br />
            <button
                className="rounded-full bg-white border border-solid border-transparent transition-colors flex items-center justify-center text-gray-800 gap-2 hover:bg-[#ccc] dark:hover:bg-[#ccc] font-medium text-sm sm:text-base h-10 sm:h-12 px-4 sm:px-5 sm:w-auto"
                onClick={
                    () => Reload()
                }
            >
                다시 시도
            </button>
        </div>
    );
}