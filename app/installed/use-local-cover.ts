import { useEffect, useState } from "react";
import { cacheWebPlayCover, readCachedWebPlayCover } from "@/app/play/[workId]/web-play-cover";

export function useLocalCover(hash: string | null) {
  const [cached, setCached] = useState<{ hash: string; url: string } | null>(null);
  useEffect(() => {
    if (!hash) return;
    let current = true;
    let url: string | undefined;
    void readCachedWebPlayCover(hash).then(async cachedBlob => {
      const blob = cachedBlob ?? await cacheWebPlayCover(hash);
      if (!current || !blob) return;
      url = URL.createObjectURL(blob);
      setCached({ hash, url });
    }).catch(() => {});
    return () => { current = false; if (url) URL.revokeObjectURL(url); };
  }, [hash]);
  return cached?.hash === hash ? cached.url : undefined;
}
