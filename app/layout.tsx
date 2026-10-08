import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '两人厨房 · 今晚吃什么', description: '从冰箱里的食材，到两个人都想吃的晚餐。', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-CN"><body>{children}</body></html>; }
