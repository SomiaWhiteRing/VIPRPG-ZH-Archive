import { createContext, useContext, type Dispatch, type SetStateAction } from "react";
import type { ColorTheme } from "@/lib/account-preferences";

export const ColorThemePreviewContext = createContext<Dispatch<SetStateAction<ColorTheme | null>> | null>(null);

export function useColorThemePreview() {
  const setPreview = useContext(ColorThemePreviewContext);
  if (!setPreview) throw new Error("外观预览需要网站主题上下文。");
  return setPreview;
}
