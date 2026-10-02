import { Popover as Primitive } from "radix-ui";
import type { ComponentPropsWithoutRef, ComponentRef, RefObject } from "react";
import { createContext, forwardRef, useContext, useLayoutEffect, useState } from "react";

export const Root = Primitive.Root;
export const Trigger = Primitive.Trigger;
export const Anchor = Primitive.Anchor;

const BoundaryContext = createContext<HTMLElement | null>(null);

export function Portal({ anchorRef, ...props }: Omit<ComponentPropsWithoutRef<typeof Primitive.Portal>, "container"> & {
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const [container, setContainer] = useState<HTMLElement | null | undefined>(undefined);
  useLayoutEffect(() => {
    // Modal scroll locks allow only descendants of their content. A body portal
    // would sit outside that boundary even though React considers it a child.
    setContainer(anchorRef.current?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? null);
  }, [anchorRef]);
  // Resolve the anchor before mounting content, including initially-open popovers.
  if (container === undefined) return null;
  return <BoundaryContext.Provider value={container}>
    <Primitive.Portal {...props} container={container ?? undefined} />
  </BoundaryContext.Provider>;
}

export const Content = forwardRef<
  ComponentRef<typeof Primitive.Content>,
  ComponentPropsWithoutRef<typeof Primitive.Content>
>(function Content({ collisionBoundary, ...props }, ref) {
  const boundary = useContext(BoundaryContext);
  return <Primitive.Content {...props} ref={ref} collisionBoundary={collisionBoundary ?? boundary ?? undefined} />;
});
