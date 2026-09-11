import { requirePermission } from "@/lib/server/auth/authorize";
import { mergeWorks } from "@/lib/server/db/catalog-maintenance";
import { parsePositiveId } from "@/lib/server/http/request";
import { json, jsonError } from "@/lib/server/http/json";

export async function POST(request: Request, context: { params: Promise<{ workId: string }> }) {
  const auth=await requirePermission(request,"work.merge_any");
  if("response" in auth) return auth.response;
  try {
    const source=parsePositiveId((await context.params).workId,"work id");
    const target=parsePositiveId(String((await request.formData()).get("target_id")??""),"target id");
    await mergeWorks(auth.user,source,target);
    return json({ok:true,redirectTo:`/admin/works/${target}`});
  } catch(error) {return jsonError("作品合并失败",error);}
}
