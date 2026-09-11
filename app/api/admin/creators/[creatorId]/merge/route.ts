import { requirePermission } from "@/lib/server/auth/authorize";
import { mergeCreators } from "@/lib/server/db/catalog-maintenance";
import { parsePositiveId } from "@/lib/server/http/request";
import { json, jsonError } from "@/lib/server/http/json";

export async function POST(request: Request, context: { params: Promise<{ creatorId: string }> }) {
  const auth=await requirePermission(request,"creator.merge_any");
  if("response" in auth) return auth.response;
  try {
    const source=parsePositiveId((await context.params).creatorId,"creator id");
    const target=parsePositiveId(String((await request.formData()).get("target_id")??""),"target id");
    await mergeCreators(auth.user,source,target);
    return json({ok:true,redirectTo:`/admin/creators/${target}`});
  } catch(error) {return jsonError("人物合并失败",error);}
}
