import { Button } from "@/app/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

type BackLinkProps = {
  href: string;
  label: string;
};

export function BackLink({ href, label }: BackLinkProps) {
  return (
    <Button asChild variant="outline">
      <Link to={href}>
        <ArrowLeft aria-hidden className="size-4" />
        {label}
      </Link>
    </Button>
  );
}
