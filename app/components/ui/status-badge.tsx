import {
  archiveStatusBadgeClass,
  archiveStatusLabel,
  importTaskStatusBadgeClass,
  importTaskStatusLabel,
  inboxStatusBadgeClass,
  inboxStatusLabel,
  roleLabel,
  userRoleBadgeClass,
  userStatusBadgeClass,
  userStatusLabel,
  workStatusBadgeClass,
  workStatusLabel,
} from "@/lib/labels";

type StatusBadgeProps = {
  kind:
    | "publication"
    | "archive"
    | "import-task"
    | "role"
    | "approval"
    | "account";
  value: string;
  purgedAt?: string | null;
};

type BadgeMeta = {
  label: string;
  tone: string;
};

export function StatusBadge({ kind, value, purgedAt = null }: StatusBadgeProps) {
  const meta = badgeMeta(kind, value, purgedAt);

  return (
    <span className={`badge status-badge status-badge--${meta.tone}`}>
      {meta.label}
    </span>
  );
}

function badgeMeta(
  kind: StatusBadgeProps["kind"],
  value: string,
  purgedAt: string | null,
): BadgeMeta {
  switch (kind) {
    case "publication":
      return {
        label: workStatusLabel(value),
        tone: toneFromLegacyClass(workStatusBadgeClass(value)),
      };
    case "archive":
      return {
        label: archiveStatusLabel(value, purgedAt),
        tone: toneFromLegacyClass(archiveStatusBadgeClass(value, purgedAt)),
      };
    case "import-task":
      return {
        label: importTaskStatusLabel(value),
        tone: toneFromLegacyClass(importTaskStatusBadgeClass(value)),
      };
    case "approval":
      return {
        label: inboxStatusLabel(value),
        tone: toneFromLegacyClass(inboxStatusBadgeClass(value)),
      };
    case "account":
      return {
        label: userStatusLabel(value),
        tone: toneFromLegacyClass(userStatusBadgeClass(value)),
      };
    case "role": {
      const role = value as Parameters<typeof roleLabel>[0];
      return {
        label: roleLabel(role),
        tone: userRoleBadgeClass(role),
      };
    }
  }
}

function toneFromLegacyClass(value: string): string {
  if (value === "approved") {
    return "positive";
  }
  if (value === "rejected") {
    return "negative";
  }
  return "pending";
}
