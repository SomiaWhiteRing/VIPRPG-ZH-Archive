export const MAX_RESOURCE_ICON_BYTES = 512 * 1024;
export const RESOURCE_TARGETS = ["windows-x64", "android-universal"] as const;
export type ResourceTarget = (typeof RESOURCE_TARGETS)[number];
export type PackageFormat = "zip" | "exe" | "apk";
export type ResourceRecord = {
  id: string;
  kind: "tool" | "website";
  slug: string;
  name: string;
  summary_json: string;
  links_json: string;
  windows_button_label: string;
  android_button_label: string;
  download_filename_template: string;
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
  crc32: number | null;
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
export type ResourceLink = { label: string; url: string };
export function resourceLinks(resource: Pick<ResourceRecord, "links_json">): ResourceLink[] {
  return JSON.parse(resource.links_json);
}
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

export const resourceContentClassName = "space-y-2 break-words whitespace-pre-wrap [&_p]:min-h-[1em] [&_h3]:text-base [&_h3]:font-bold [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_a]:text-primary [&_a]:underline";
