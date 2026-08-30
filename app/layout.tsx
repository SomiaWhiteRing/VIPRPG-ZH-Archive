import type { Metadata } from "next";
import { SiteHeader } from "@/app/components/site-header";
import { SiteFooter } from "@/app/components/site-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "VIPRPG.org",
  description: "RPG Maker 作品发现、游玩与下载空间",
  icons: {
    icon: "/icon/windI.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className="scroll-smooth motion-reduce:scroll-auto" lang="zh-Hans">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased" suppressHydrationWarning>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
