import Link from "next/link";
import type { ComponentPropsWithoutRef, MouseEventHandler, ReactNode } from "react";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/ui/cn";

type Rm2kButtonProps = {
  children: ReactNode;
  icon?: ReactNode;
  href?: string;
  className?: string;
  type?: ComponentPropsWithoutRef<"button">["type"];
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLElement>;
  role?: string;
  "aria-controls"?: string;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "dialog";
  "aria-selected"?: boolean;
  iconPosition?: "start" | "end";
  size?: "default" | "large";
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
  "aria-controls": ariaControls,
  "aria-expanded": ariaExpanded,
  "aria-haspopup": ariaHasPopup,
  "aria-selected": ariaSelected,
  iconPosition = "start",
  size = "default",
}: Rm2kButtonProps) {
  const buttonClassName = cn(
    size === "large" && "min-h-14 justify-start gap-1.5 px-2 text-sm sm:min-h-20 sm:gap-4 sm:px-4 sm:text-xl",
    className,
  );
  const content = (
    <>
      {icon && iconPosition === "start" ? <span aria-hidden="true">{icon}</span> : null}
      {children}
      {icon && iconPosition === "end" ? <span aria-hidden="true">{icon}</span> : null}
    </>
  );
  if (href) {
    return (
      <Button asChild aria-disabled={disabled || undefined} className={buttonClassName} variant="rm2k">
        <Link
          aria-controls={ariaControls}
          aria-expanded={ariaExpanded}
          aria-haspopup={ariaHasPopup}
          aria-selected={ariaSelected}
          href={href}
          onClick={
            disabled || onClick
              ? (event) => {
                  if (disabled) event.preventDefault();
                  onClick?.(event);
                }
              : undefined
          }
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
      aria-controls={ariaControls}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHasPopup}
      className={buttonClassName}
      disabled={disabled}
      onClick={onClick as MouseEventHandler<HTMLButtonElement>}
      type={type}
      variant="rm2k"
    >
      {content}
    </Button>
  );
}
