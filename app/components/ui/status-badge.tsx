import { archiveStatusLabel, importTaskStatusLabel, inboxStatusLabel, installStatusLabel, userStatusLabel, workStatusLabel } from "@/lib/labels";
import type { WebPlayInstallStatus } from "@/app/play/[workId]/web-play-types";
import { Badge } from "@/app/components/ui/badge";
import type { UiLocale } from "@/lib/i18n/locale";
import { useUiLocale } from "@/lib/i18n/react";
import { translate } from "@/lib/i18n/core";

type StatusBadgeProps =
  | {
      kind: "publication" | "archive" | "import-task" | "approval" | "account";
      value: string;
      purgedAt?: string | null;
    }
  | {
      kind: "browser-install";
      value: WebPlayInstallStatus | "loading";
      purgedAt?: never;
    }
  | {
      kind: "player";
      value: "running" | "starting" | "idle";
      purgedAt?: never;
    };

type BadgeTone = "pending" | "positive" | "uploader" | "negative" | "user" | "admin" | "super-admin";

type BadgeMeta = {
  label: string;
  tone: BadgeTone;
};

export function StatusBadge(props: StatusBadgeProps) {
  const meta = badgeMeta(props, useUiLocale());

  return <Badge variant={meta.tone}>{meta.label}</Badge>;
}

function badgeMeta(props: StatusBadgeProps, locale: UiLocale): BadgeMeta {
  switch (props.kind) {
    case "publication":
      return {
        label: workStatusLabel(props.value, locale),
        tone: publicationTone(props.value),
      };
    case "archive":
      return {
        label: archiveStatusLabel(props.value, props.purgedAt ?? null, locale),
        tone: archiveTone(props.value, props.purgedAt ?? null),
      };
    case "import-task":
      return {
        label: importTaskStatusLabel(props.value, locale),
        tone: importTaskTone(props.value),
      };
    case "browser-install":
      return {
        label: installStatusLabel(props.value, locale),
        tone: browserInstallTone(props.value),
      };
    case "player":
      return {
        label: translate(locale, `play.install.${props.value}`),
        tone: props.value === "running" ? "positive" : "pending",
      };
    case "approval":
      return {
        label: inboxStatusLabel(props.value, locale),
        tone: approvalTone(props.value),
      };
    case "account":
      return {
        label: userStatusLabel(props.value, locale),
        tone: props.value === "active" ? "positive" : "negative",
      };
  }
}

function browserInstallTone(value: WebPlayInstallStatus | "loading"): BadgeTone {
  if (value === "ready") {
    return "positive";
  }
  if (value === "failed") {
    return "negative";
  }
  return "pending";
}

function publicationTone(value: string): BadgeTone {
  if (value === "published") return "positive";
  if (value === "hidden" || value === "deleted") return "negative";
  return "pending";
}

function archiveTone(value: string, purgedAt: string | null): BadgeTone {
  if (purgedAt || value === "deleted") return "negative";
  return value === "published" ? "positive" : "pending";
}

function importTaskTone(value: string): BadgeTone {
  if (value === "completed") {
    return "positive";
  }
  if (value === "failed" || value === "canceled" || value === "expired") return "negative";
  return "pending";
}

function approvalTone(value: string): BadgeTone {
  if (value === "approved") return "positive";
  if (value === "rejected") return "negative";
  return "pending";
}
