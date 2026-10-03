import { startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

startTransition(() => {
  hydrateRoot(document, <HydratedRouter />, {
    onRecoverableError(error, info) {
      console.error("[hydration-detail]", error, info.componentStack);
      reportError(error);
    },
  });
});
