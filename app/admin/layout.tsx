import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-[min(1280px,calc(100vw-2rem))] py-5 sm:py-7 [&_main]:grid [&_main]:gap-5">
      {children}
    </div>
  );
}
