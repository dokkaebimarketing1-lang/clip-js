'use client'
import { Github, Twitter, Linkedin, Heart } from "lucide-react";
import { useState } from "react";

export default function AboutMe() {
    const [hovered, setHovered] = useState(false);

    return (
        <div className="flex flex-col items-center mt-20 min-h-screen py-16 px-4">
            <div className="max-w-3xl w-full bg-black bg-opacity-30 backdrop-blur-lg border border-gray-800 border-opacity-30 rounded-xl shadow-xl p-8 text-center">
                <h1 className="text-4xl font-bold text-white mb-4">안녕하세요, Mohy Khalid입니다</h1>

                <p className="text-gray-300 mt-4 text-lg">
                    사람들에게 도움이 되는 제품을 만드는 소프트웨어 개발자입니다.
                </p>

                <div className="my-8 p-6 bg-gray-900 bg-opacity-30 backdrop-blur-lg border border-gray-800 border-opacity-30 rounded-lg">
                    <p className="text-gray-300 text-lg">
                        현재 웹 브라우저에서 영상을 바로 편집할 수 있는 브라우저 기반 영상 편집기 <span className="font-semibold text-yellow-300">ClipJS</span>를 만들고 있습니다.
                    </p>
                    <p className="text-gray-300 mt-3 text-lg">
                        렌더링을 포함한 모든 작업이 브라우저에서 이루어집니다. <span className="font-bold text-green-400">100% 무료</span>이며 워터마크 없이 최대 1080p로 내보낼 수 있습니다.
                    </p>
                </div>

                <div className="flex justify-center space-x-4 mt-8">
                    <a href="https://github.com/mohyware" className="text-gray-300 hover:text-white transition-colors">
                        <Github size={24} />
                    </a>
                    <a href="https://twitter.com/mohyware" className="text-gray-300 hover:text-white transition-colors">
                        <Twitter size={24} />
                    </a>
                    <a href="https://www.linkedin.com/in/mohyware/" className="text-gray-300 hover:text-white transition-colors">
                        <Linkedin size={24} />
                    </a>
                </div>

                <div className="mt-10">
                    <a
                        href="https://github.com/sponsors/mohyware"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center mx-auto px-5 py-3 ${hovered ? "bg-pink-500" : "bg-pink-600"} hover:bg-pink-500 rounded-lg text-gray-900 font-bold transition-all transform ${hovered ? "scale-105" : "scale-100"}`}
                        onMouseEnter={() => setHovered(true)}
                        onMouseLeave={() => setHovered(false)}
                    >
                        <Heart size={20} className="mr-2" />
                        GitHub에서 후원하기
                    </a>

                </div>
            </div>
        </div>
    );
}