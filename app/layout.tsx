import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VIPRPG 中文归档",
  description: "RPG Maker 2000/2003 游戏去重归档与下载系统",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hans">
      <body>{children}</body>
    </html>
  );
}
