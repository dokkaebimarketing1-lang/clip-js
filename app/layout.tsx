import './globals.css'
import type { Metadata, Viewport } from 'next'
import { Inter, Roboto_Mono } from "next/font/google";
import { Providers } from './providers'
import Header from "./components/header/Header";
import Footer from "./components/footer/Footer";
import { Toaster } from 'react-hot-toast';
import { Analytics } from "@vercel/analytics/next"

const geistSans = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Roboto_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: '함께봄 Ai영상제작소',
    template: '%s · 함께봄 Ai영상제작소',
  },
  description: '기획부터 캐릭터, 콘티, 생성, 편집까지 한 흐름으로 완성하는 AI 영상 제작 스튜디오',
}

export const viewport: Viewport = {
  themeColor: '#08090d',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body
        className={`min-h-screen flex flex-col bg-darkSurfacePrimary text-text-primary dark:bg-darkSurfacePrimary dark:text-dark-text-primary font-sans ${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <Header />
          <main className="flex-grow">
            <Toaster
              toastOptions={{
                style: {
                  borderRadius: '10px',
                  background: '#333',
                  color: '#fff',
                },
              }}
            />
            {children}
            {process.env.VERCEL === '1' ? <Analytics /> : null}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  )
}
