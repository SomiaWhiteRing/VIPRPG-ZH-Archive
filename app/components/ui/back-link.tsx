import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/app/components/ui/button";

type BackLinkProps = {
  href: string;
  label: string;
};

export function BackLink({ href, label }: BackLinkProps) {
  return (
    <Button asChild variant="outline">
      <Link href={href}>
        <ArrowLeft aria-hidden className="size-4" />
        {label}
      </Link>
    </Button>
  );
}
