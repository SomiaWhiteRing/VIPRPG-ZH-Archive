import { createContext, useContext, useMemo } from "react";
import { useLocation } from "react-router";
import { translate } from "./core";
import { DEFAULT_UI_LOCALE, parseUiLocale, UI_LOCALE_PARAM } from "./locale";

export const UiLocaleContext = createContext(DEFAULT_UI_LOCALE);

export function useUiLocale() {
  return useContext(UiLocaleContext);
}

export function useMessages() {
  const locale = useUiLocale();
  return useMemo(() => translate.bind(null, locale), [locale]);
}

export function useNavigationLocale() {
  const { search } = useLocation();
  return parseUiLocale(new URLSearchParams(search).get(UI_LOCALE_PARAM));
}
