export const MAX_TOOL_BYTES = 95_000_000;
export const MAX_RESOURCE_ICON_BYTES = 512 * 1024;
export const RESOURCE_TARGETS = ["windows-x64", "android-universal"] as const;
export type ResourceTarget = (typeof RESOURCE_TARGETS)[number];
export type PackageFormat = "zip" | "exe" | "apk";
export type ResourceRecord = {
  id: string;
  kind: "tool" | "website";
  slug: string;
  name: string;
  summary: string;
  description: string;
  website_url: string;
  source_url: string;
  icon_blob_sha256: string | null;
  visibility: "draft" | "published" | "hidden";
  sort_order: number;
  revision: number;
  last_release_sequence: number;
};
export type ToolRelease = {
  id: string;
  resource_id: string;
  channel: "stable";
  version_label: string;
  release_sequence: number | null;
  notes: string;
  status: "draft" | "published" | "withdrawn";
  published_at: string | null;
};
export type ToolArtifact = {
  id: string;
  release_id: string;
  target: ResourceTarget;
  format: PackageFormat;
  application_build_id: string | null;
  filename: string;
  object_key: string;
  size_bytes: number;
  sha256: string;
  storage_status:
    | "pending"
    | "uploading"
    | "uncertain"
    | "ready"
    | "cleanup"
    | "cleaned";
  upload_actor_id: number;
  upload_token: string | null;
  updated_at: string;
};
export type ToolChannel = {
  resource_id: string;
  channel: "stable";
  target: ResourceTarget;
  artifact_id: string | null;
  revision: number;
};
export type ResourceDownload = {
  id: string;
  target: ResourceTarget;
  format: PackageFormat;
  filename: string;
  size_bytes: number;
  sha256: string;
  release_id: string;
  version_label: string;
};
export type PublicResource = ResourceRecord & { downloads: ResourceDownload[] };
export type ResourceEditorData = {
  resource: ResourceRecord;
  releases: ToolRelease[];
  artifacts: ToolArtifact[];
  channels: ToolChannel[];
};
export function targetLabel(target: string) {
  return target === "windows-x64" ? "Windows x64" : "Android";
}
export function fileSize(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
