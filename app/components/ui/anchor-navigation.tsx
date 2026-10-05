import { scrollElementIntoView } from "@/lib/ui/scroll.js";
import { useContext, useLayoutEffect, useRef } from "react";
import {
  Link,
  type LinkProps,
  ScrollRestoration,
  UNSAFE_DataRouterStateContext,
  useLocation,
  useNavigationType,
  useResolvedPath,
} from "react-router";

const SMOOTH_ANCHOR_STATE = "viprpgSmoothAnchor";

export function SmoothAnchorLink({ to, state, ...props }: LinkProps) {
  const location = useLocation();
  // A fragment navigates within the current content, including its query filters.
  const destination = useResolvedPath(typeof to === "string" && to.startsWith("#")
    ? { pathname: location.pathname, search: location.search, hash: to }
    : to, { relative: props.relative });
  const smooth = !props.reloadDocument && !!destination.hash &&
    destination.pathname === location.pathname && destination.search === location.search;

  return <Link {...props} to={destination}
    state={smooth ? { ...state, [SMOOTH_ANCHOR_STATE]: destination.hash } : state} />;
}

export function PageScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const routerState = useContext(UNSAFE_DataRouterStateContext);
  const handledLocation = useRef<string | null>(null);
  const smooth = navigationType !== "POP" && !!location.hash &&
    location.state?.[SMOOTH_ANCHOR_STATE] === location.hash;

  useLayoutEffect(() => {
    if (!smooth || handledLocation.current === location.key) return;
    handledLocation.current = location.key;
    let id: string;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      // An invalid fragment leaves the current reading position intact.
      return;
    }
    const target = document.getElementById(id);
    if (target) scrollElementIntoView(target, { behavior: "smooth" });
  }, [location, smooth]);

  // React Router handles hashes before preventScrollReset. Suppress only its
  // positioning for opted-in clicks; keep its history/session restoration intact.
  // POP entries, including previously smooth anchors, retain normal restoration.
  return <UNSAFE_DataRouterStateContext.Provider
    value={smooth && routerState ? { ...routerState, restoreScrollPosition: false } : routerState}
  >
    <ScrollRestoration />
  </UNSAFE_DataRouterStateContext.Provider>;
}
