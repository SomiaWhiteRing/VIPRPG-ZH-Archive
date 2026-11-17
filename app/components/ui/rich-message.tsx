import type { ReactNode } from "react";
import { formatMessage, type MessageKey } from "@/lib/i18n/core";
import { useUiLocale } from "@/lib/i18n/react";

export function RichMessage({ id, values, components }: {
  id: MessageKey;
  values?: Record<string, string | number>;
  components: Record<string, (children: ReactNode[]) => ReactNode>;
}) {
  return <>{formatMessage<ReactNode>(useUiLocale(), id, { ...values, ...components })}</>;
}
