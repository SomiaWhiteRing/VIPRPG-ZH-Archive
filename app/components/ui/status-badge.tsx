import { archiveStatusLabel, importTaskStatusLabel, inboxStatusLabel, installStatusLabel, uploadTaskStatusLabel, userStatusLabel, workStatusLabel } from "@/lib/labels";
import type { WebPlayInstallStatus } from "@/app/play/[archiveVersionId]/web-play-types";
import type { UploadTaskStatus } from "@/app/upload/upload-types";
import { Badge } from "@/app/components/ui/badge";

type StatusBadgeProps =
  | {
      kind: "publication" | "archive" | "import-task" | "approval" | "account";
      value: string;
      purgedAt?: string | null;
    }
  | { kind: "upload-task"; value: UploadTaskStatus; purgedAt?: never }
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
  const meta = badgeMeta(props);

  return <Badge variant={meta.tone}>{meta.label}</Badge>;
}

function badgeMeta(props: StatusBadgeProps): BadgeMeta {
  switch (props.kind) {
    case "publication":
      return {
        label: workStatusLabel(props.value),
        tone: publicationTone(props.value),
      };
    case "archive":
      return {
        label: archiveStatusLabel(props.value, props.purgedAt ?? null),
        tone: archiveTone(props.value, props.purgedAt ?? null),
      };
    case "import-task":
      return {
        label: importTaskStatusLabel(props.value),
        tone: importTaskTone(props.value),
      };
    case "upload-task":
      return {
        label: uploadTaskStatusLabel(props.value),
        tone: uploadTaskTone(props.value),
      };
    case "browser-install":
      return {
        label: installStatusLabel(props.value),
        tone: browserInstallTone(props.value),
      };
    case "player":
      return {
        label: props.value === "running" ? "运行中" : props.value === "starting" ? "启动中" : "待机",
        tone: props.value === "running" ? "positive" : "pending",
      };
    case "approval":
      return {
        label: inboxStatusLabel(props.value),
        tone: approvalTone(props.value),
      };
    case "account":
      return {
        label: userStatusLabel(props.value),
        tone: props.value === "active" ? "positive" : "negative",
      };
  }
}

function uploadTaskTone(value: UploadTaskStatus): BadgeTone {
  if (value === "completed") {
    return "positive";
  }
  if (value === "failed" || value === "canceled") {
    return "negative";
  }
  return "pending";
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
  if (value === "completed" || value === "succeeded" || value === "committed") {
    return "positive";
  }
  if (value === "failed" || value === "canceled") return "negative";
  return "pending";
}

function approvalTone(value: string): BadgeTone {
  if (value === "approved") return "positive";
  if (value === "rejected") return "negative";
  return "pending";
}
