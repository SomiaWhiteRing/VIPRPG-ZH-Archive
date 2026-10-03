import { Popover as Primitive } from "radix-ui";
import { type ComponentPropsWithoutRef, type ComponentRef, type RefObject, createContext, forwardRef, useContext, useLayoutEffect, useState } from "react";


export const Root = Primitive.Root;
export const Trigger = Primitive.Trigger;
export const Anchor = Primitive.Anchor;
export const Arrow = Primitive.Arrow;
export const Close = Primitive.Close;

const BoundaryContext = createContext<HTMLElement | null>(null);

export function Portal({ anchorRef, container: providedContainer, ...props }: Omit<ComponentPropsWithoutRef<typeof Primitive.Portal>, "container"> & {
  anchorRef: RefObject<HTMLElement | null>;
  container?: HTMLElement | null;
}) {
  const [container, setContainer] = useState<HTMLElement | null | undefined>(undefined);
  useLayoutEffect(() => {
    // Modal scroll locks allow only descendants of their content. A body portal
    // would sit outside that boundary even though React considers it a child.
    setContainer(providedContainer ?? anchorRef.current?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? null);
  }, [anchorRef, providedContainer]);
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
