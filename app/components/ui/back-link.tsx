import Link from "next/link";

type BackLinkProps = {
  href: string;
  label: string;
};

export function BackLink({ href, label }: BackLinkProps) {
  return (
    <Link className="button back-link" href={href}>
      <span aria-hidden>←</span>
      {label}
    </Link>
  );
}
