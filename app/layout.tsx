import type { Metadata } from "next";
import { SiteHeader } from "@/app/components/site-header";
import { SiteFooter } from "@/app/components/site-footer";
import { DiscussionVisitBoundary } from "@/app/discussions/visit";
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
    // Browser extensions (e.g. Immersive Translate) may add root attributes before hydration.
    <html className="scroll-smooth motion-reduce:scroll-auto" data-scroll-behavior="smooth" lang="zh-Hans" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased" suppressHydrationWarning>
        <DiscussionVisitBoundary />
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
