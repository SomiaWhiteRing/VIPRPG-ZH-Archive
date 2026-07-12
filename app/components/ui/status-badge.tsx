import {
  archiveStatusBadgeClass,
  archiveStatusLabel,
  importTaskStatusBadgeClass,
  importTaskStatusLabel,
  inboxStatusBadgeClass,
  inboxStatusLabel,
  installStatusLabel,
  roleLabel,
  uploadTaskStatusLabel,
  userStatusBadgeClass,
  userStatusLabel,
  workStatusBadgeClass,
  workStatusLabel,
} from "@/lib/labels";
import type { WebPlayInstallStatus } from "@/app/play/[archiveVersionId]/web-play-types";
import type { UploadTaskStatus } from "@/app/upload/upload-types";

type StatusBadgeProps =
  | {
      kind: "publication" | "archive" | "import-task" | "approval" | "account";
      value: string;
      purgedAt?: string | null;
    }
  | { kind: "upload-task"; value: UploadTaskStatus; purgedAt?: never }
  | { kind: "browser-install"; value: WebPlayInstallStatus | "loading"; purgedAt?: never }
  | { kind: "player"; value: "running" | "starting" | "idle"; purgedAt?: never }
  | { kind: "role"; value: Parameters<typeof roleLabel>[0]; purgedAt?: never };

type BadgeTone =
  | "pending"
  | "positive"
  | "uploader"
  | "negative"
  | "user"
  | "admin"
  | "super-admin";

type BadgeMeta = {
  label: string;
  tone: BadgeTone;
};

export function StatusBadge(props: StatusBadgeProps) {
  const meta = badgeMeta(props);

  return (
    <span className={`badge status-badge status-badge--${meta.tone}`}>
      {meta.label}
    </span>
  );
}

function badgeMeta(props: StatusBadgeProps): BadgeMeta {
  switch (props.kind) {
    case "publication":
      return {
        label: workStatusLabel(props.value),
        tone: toneFromLegacyClass(workStatusBadgeClass(props.value)),
      };
    case "archive":
      return {
        label: archiveStatusLabel(props.value, props.purgedAt ?? null),
        tone: toneFromLegacyClass(archiveStatusBadgeClass(props.value, props.purgedAt ?? null)),
      };
    case "import-task":
      return {
        label: importTaskStatusLabel(props.value),
        tone: toneFromLegacyClass(importTaskStatusBadgeClass(props.value)),
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
        label:
          props.value === "running"
            ? "运行中"
            : props.value === "starting"
              ? "启动中"
              : "待机",
        tone: props.value === "running" ? "positive" : "pending",
      };
    case "approval":
      return {
        label: inboxStatusLabel(props.value),
        tone: toneFromLegacyClass(inboxStatusBadgeClass(props.value)),
      };
    case "account":
      return {
        label: userStatusLabel(props.value),
        tone: toneFromLegacyClass(userStatusBadgeClass(props.value)),
      };
    case "role": {
      return {
        label: roleLabel(props.value),
        tone: roleTone(props.value),
      };
    }
  }
}

function roleTone(value: Parameters<typeof roleLabel>[0]): BadgeTone {
  switch (value) {
    case "uploader":
      return "uploader";
    case "admin":
      return "admin";
    case "super_admin":
      return "super-admin";
    default:
      return "user";
  }
}

function uploadTaskTone(value: UploadTaskStatus): BadgeTone {
  if (value === "completed") {
    return "positive";
  }
  if (value === "failed_recoverable" || value === "failed_terminal" || value === "canceled") {
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

function toneFromLegacyClass(value: string): BadgeTone {
  if (value === "approved") {
    return "positive";
  }
  if (value === "rejected") {
    return "negative";
  }
  return "pending";
}
