import { requirePermission } from "@/lib/server/auth/authorize";
import { setWorkMaintainer } from "@/lib/server/db/catalog-maintenance";
import { parsePositiveId } from "@/lib/server/http/request";
import { json, jsonError } from "@/lib/server/http/json";

export async function POST(request: Request, context: { params: Promise<{ workId: string }> }) {
  const auth=await requirePermission(request,"work.maintainer.manage_any");
  if("response" in auth) return auth.response;
  try {
    const id=parsePositiveId((await context.params).workId,"work id");
    const form=await request.formData();
    await setWorkMaintainer(auth.user,id,String(form.get("email")??""),form.get("remove")==="1");
    return json({ok:true,redirectTo:`/admin/works/${id}`});
  } catch(error) {return jsonError("维护者调整失败",error);}
}
