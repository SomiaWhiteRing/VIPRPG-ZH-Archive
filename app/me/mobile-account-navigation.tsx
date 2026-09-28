import { Button } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { ACCOUNT_NAVIGATION, isAccountNavigationActive } from "@/lib/account-navigation";
import { cn } from "@/lib/ui/cn";
import { ChevronDown, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useOutletContext } from "react-router";

export type AccountOutletContext = { canUpload: boolean };

type MobileAccountNavigationProps = {
  children: ReactNode;
  heading?: boolean;
};

export function MobileAccountNavigation(props: MobileAccountNavigationProps) {
  const location = useLocation();
  return <MobileAccountNavigationMenu key={location.key} {...props} />;
}

function MobileAccountNavigationMenu({ children, heading = false }: MobileAccountNavigationProps) {
  const { canUpload } = useOutletContext<AccountOutletContext>();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const items = ACCOUNT_NAVIGATION.filter((item) => !item.requiresUpload || canUpload);
  const groups = [...new Set(items.map((item) => item.group))];

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 48rem)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          type="button"
          variant="neutral"
          className={cn("min-h-11 max-w-full whitespace-normal text-left", heading && "font-[inherit] text-[length:inherit] leading-[inherit] tracking-[inherit]")}
        >
          {children}
          <ChevronDown aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content
          aria-describedby={undefined}
          className="inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
            <Dialog.Title>个人中心</Dialog.Title>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="icon" className="size-11" aria-label="关闭个人中心导航">
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          <nav aria-label="个人中心导航" className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {groups.map((group) => (
              <div key={group ?? "overview"}>
                {group ? <h2 className="mb-2 text-xs font-semibold text-muted">{group}</h2> : null}
                <div className="grid grid-cols-2 gap-2">
                  {items.filter((item) => item.group === group).map((item) => {
                    const active = isAccountNavigationActive(item, location.pathname);
                    return (
                      <Dialog.Close asChild key={item.href}>
                        <Link
                          to={item.href}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex min-h-11 items-center rounded-md border px-3 py-2 text-sm transition-colors",
                            active ? "border-primary/30 bg-primary/10 font-semibold text-secondary" : "border-border text-foreground hover:bg-muted/15",
                          )}
                        >
                          {item.label}
                        </Link>
                      </Dialog.Close>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
