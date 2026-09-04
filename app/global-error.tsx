"use client";

import { useEffect } from "react";
import { Button } from "@/app/components/ui/button";
import "./globals.css";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Application rendering failed", error);
  }, [error]);

  return (
    <html lang="zh-Hans">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <title>页面暂时无法加载 · VIPRPG.org</title>
        <main className="mx-auto grid w-[min(720px,calc(100vw-2rem))] gap-4 py-12">
          <h1 className="m-0 text-2xl font-bold">页面暂时无法加载</h1>
          <p className="m-0 text-muted" role="alert">
            应用界面发生意外错误。请先重试；如果仍然失败，请刷新页面。
          </p>
          {error.digest ? <p className="m-0 text-xs text-muted">错误编号：{error.digest}</p> : null}
          <div className="flex gap-2">
            <Button onClick={() => retry()} type="button">重试</Button>
            <Button onClick={() => window.location.reload()} type="button" variant="outline">刷新页面</Button>
          </div>
        </main>
      </body>
    </html>
  );
}
