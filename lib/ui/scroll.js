/** @param {ScrollBehavior} [behavior] @returns {"instant" | "smooth"} */
export function resolveScrollBehavior(behavior = "instant") {
  return behavior === "smooth" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "smooth"
    : "instant";
}

/** @param {Window | Element} viewport @param {ScrollToOptions} options */
export function scrollToPosition(viewport, options) {
  viewport.scrollTo({ ...options, behavior: resolveScrollBehavior(options.behavior) });
}

/** @param {Window | Element} viewport @param {ScrollToOptions} options */
export function scrollByOffset(viewport, options) {
  viewport.scrollBy({ ...options, behavior: resolveScrollBehavior(options.behavior) });
}

/** @param {Element} element @param {ScrollIntoViewOptions} [options] */
export function scrollElementIntoView(element, options = {}) {
  element.scrollIntoView({ ...options, behavior: resolveScrollBehavior(options.behavior) });
}
