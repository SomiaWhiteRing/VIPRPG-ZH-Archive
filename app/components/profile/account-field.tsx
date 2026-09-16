import type { ReactNode } from "react";
import { Label } from "@/app/components/ui/label";

export function AccountField({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-[150px_minmax(0,1fr)] md:items-center">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
