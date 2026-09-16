import type { latestUploaderRequest } from "@/app/.server/db/permissions";
import { Button } from "@/app/components/ui/button";
import { hasUploaderAccess } from "@/lib/authz/permissions";
import { Link } from "react-router";

export function UploadAccess({
  user,
  request,
}: {
  user: Parameters<typeof hasUploaderAccess>[0];
  request: Awaited<ReturnType<typeof latestUploaderRequest>>;
}) {
  const granted = hasUploaderAccess(user);
  const pending = request?.status === "pending";
  return (
    <section
      className="scroll-mt-20 border-y border-border py-4"
      id="upload-access"
      aria-labelledby="upload-access-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold" id="upload-access-heading">
            上传权限
          </h2>
          <p className="mt-1 text-sm text-muted">
            {granted
              ? "已获得完整上传与作品维护权限。"
              : pending
                ? "申请已提交，等待管理员审批。"
                : request?.status === "rejected"
                  ? "上次申请未通过，可以重新申请。"
                  : request?.status === "approved"
                    ? "之前的申请已通过，当前权限不完整，可重新申请。"
                    : "申请后可发布本站归档、外部下载作品，并维护自己的作品。"}
          </p>
        </div>
        {granted ? (
          <Link className="text-sm font-semibold text-primary" to="/upload">
            发布作品
          </Link>
        ) : pending ? (
          <Link className="text-sm text-primary" to="/inbox">
            查看申请
          </Link>
        ) : (
          <form action="/api/account/request-upload-access" method="post">
            <Button type="submit">
              {request ? "重新申请上传权限" : "申请上传权限"}
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
