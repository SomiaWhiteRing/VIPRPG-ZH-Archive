import { ACCOUNT_DELETION_ACKNOWLEDGEMENT } from "@/lib/auth/account-deletion";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { HttpError } from "@/lib/http";

export function assertAccountDeletionRequest(user: ArchiveUser, acknowledgement: string) {
  if (user.isBootstrapAdmin) {
    throw new HttpError(400, "请先轮换根账户，再注销此账号");
  }
  if (user.status !== "active" || !user.email) {
    throw new HttpError(400, "当前账号无法注销");
  }
  if (acknowledgement !== ACCOUNT_DELETION_ACKNOWLEDGEMENT) {
    throw new HttpError(400, `请完整输入“${ACCOUNT_DELETION_ACKNOWLEDGEMENT}”`);
  }
}
