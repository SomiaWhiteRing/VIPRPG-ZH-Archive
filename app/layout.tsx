import type { Metadata } from "next";
import { UploadTaskProvider } from "@/app/upload/upload-task-provider";
import { SiteHeader } from "@/app/components/site-header";
import { SiteFooter } from "@/app/components/site-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "VIPRPG.org",
  description: "RPG Maker 2000/2003 作品发现、游玩与下载空间",
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
    <html lang="zh-Hans">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased" suppressHydrationWarning>
        <UploadTaskProvider>
          <SiteHeader />
          {children}
          <SiteFooter />
        </UploadTaskProvider>
      </body>
    </html>
  );
}
