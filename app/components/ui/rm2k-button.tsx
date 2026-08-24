import Link from "next/link";
import type { ComponentPropsWithoutRef, MouseEventHandler, ReactNode } from "react";
import { Button } from "@/app/components/ui/button";

type Rm2kButtonProps = {
  children: ReactNode;
  icon?: ReactNode;
  href?: string;
  className?: string;
  type?: ComponentPropsWithoutRef<"button">["type"];
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLElement>;
  role?: string;
  "aria-selected"?: boolean;
  iconPosition?: "start" | "end";
};

export function Rm2kButton({
  children,
  icon,
  href,
  className,
  type = "button",
  disabled = false,
  onClick,
  role,
  "aria-selected": ariaSelected,
  iconPosition = "start",
}: Rm2kButtonProps) {
  const content = (
    <>
      {icon && iconPosition === "start" ? <span aria-hidden="true">{icon}</span> : null}
      {children}
      {icon && iconPosition === "end" ? <span aria-hidden="true">{icon}</span> : null}
    </>
  );
  if (href) {
    return (
      <Button asChild aria-disabled={disabled || undefined} className={className} variant="rm2k">
        <Link
          aria-selected={ariaSelected}
          href={href}
          onClick={(event) => {
            if (disabled) event.preventDefault();
            onClick?.(event);
          }}
          role={role}
          tabIndex={disabled ? -1 : undefined}
        >
          {content}
        </Link>
      </Button>
    );
  }
  return (
    <Button
      className={className}
      disabled={disabled}
      onClick={onClick as MouseEventHandler<HTMLButtonElement>}
      type={type}
      variant="rm2k"
    >
      {content}
    </Button>
  );
}
