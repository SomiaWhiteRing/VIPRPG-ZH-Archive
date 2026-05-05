"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function ThemeBodyClass() {
  const pathname = usePathname() ?? "/";

  useEffect(() => {
    const cls = pathname.startsWith("/admin")
      ? "theme-admin"
      : "theme-festival";
    document.body.classList.remove("theme-admin", "theme-festival");
    document.body.classList.add(cls);
    return () => {
      document.body.classList.remove(cls);
    };
  }, [pathname]);

  return null;
}
