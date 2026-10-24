import { startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

// CDN-injected head scripts can leave whitespace between elements. React's
// document hydration stops matching stylesheet links at those text nodes.
for (const node of Array.from(document.head.childNodes)) {
  if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) node.remove();
}

startTransition(() => {
  hydrateRoot(document, <HydratedRouter />);
});
