import type { PermissionKey } from "@/lib/authz/permissions";

// Request shape selects an operation, never its authorization scope.
export function characterIndexPermission(body: Record<string, unknown>): PermissionKey | null {
  switch (body.operation) {
    case "saveCategory": return body.categoryId == null ? "character_category.create" : "character_category.update";
    case "deleteCategory": return "character_category.delete";
    case "addCharacters": return "character_membership.create";
    case "saveMembership": return "character_membership.update";
    case "removeCharacter": return "character_membership.delete";
    case "reorder":
    case "reorderTo": return "character_index.reorder";
    case "saveSources": return "character.sources.update_any";
    default: return null;
  }
}
