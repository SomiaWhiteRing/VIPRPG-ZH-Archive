import { uploadInitialWork } from "@/app/upload/initial-work";
import { UploadClient } from "@/app/upload/upload-client";
import type { AdminWorkEdit } from "@/lib/dto/db/game-library";
import type { ComponentProps, ReactNode } from "react";

export function WorkEditForm({ work, currentUser, suggestions, canUpdateStatus, children }: {
  work: AdminWorkEdit;
  currentUser: ComponentProps<typeof UploadClient>["currentUser"];
  suggestions: ComponentProps<typeof UploadClient>["suggestions"];
  canUpdateStatus: boolean;
  children: ReactNode;
}) {
  return <UploadClient
    currentUser={currentUser}
    initialWork={uploadInitialWork(work)}
    saveRedirectTo={`/admin/works/${work.id}`}
    suggestions={suggestions}
    adminOptions={{
      canUpdateStatus,
      status: work.status === "processing" ? "hidden" : work.status,
      externalLinks: work.externalLinks,
      footer: children,
    }}
  />;
}
