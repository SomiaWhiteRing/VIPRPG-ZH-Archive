import type { WorkCreditSort } from "@/lib/params";

export const workCreditOrder: Record<WorkCreditSort, string> = {
  upload: "w.created_at DESC,w.id DESC",
  release: "w.original_release_date IS NULL ASC,w.original_release_date DESC,w.original_title ASC,w.id DESC",
};
