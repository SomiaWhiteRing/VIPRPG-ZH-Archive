import type { Metadata } from "next";
import { UploadTaskProvider } from "@/app/upload/upload-task-provider";
import { SiteHeader } from "@/app/components/site-header";
import { SiteFooter } from "@/app/components/site-footer";
import { ThemeBodyClass } from "@/app/components/theme-body-class";
import "./globals.css";

export const metadata: Metadata = {
  title: "VIPRPG 中文归档",
  description: "RPG Maker 2000/2003 游戏去重归档与下载系统",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hans">
      <body className="theme-festival">
        <ThemeBodyClass />
        <UploadTaskProvider>
          <SiteHeader />
          {children}
          <SiteFooter />
        </UploadTaskProvider>
      </body>
    </html>
  );
}
