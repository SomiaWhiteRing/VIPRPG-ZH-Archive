import { requireUser } from '@/app/.server/auth/guards';
import { getMaintainerApplication, requestWorkMaintainer } from '@/app/.server/db/work-maintainers';
import { parsePositiveId, readJsonObject } from '@/app/.server/http/request';
import type { AppRuntime } from '@/app/.server/runtime';
import { HttpError, json, jsonError } from '@/lib/http';

type Context = { params: { workId: string } };
export async function GET(runtime: AppRuntime, request: Request, context: Context) {
  const auth = await requireUser(runtime, request);
  if ('response' in auth) return auth.response;
  try {
    const application = await getMaintainerApplication(runtime, parsePositiveId(context.params.workId), auth.user);
    return json({ ok: true, application }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return jsonError('读取维护申请失败', error); }
}

export async function POST(runtime: AppRuntime, request: Request, context: Context) {
  const auth = await requireUser(runtime, request);
  if ('response' in auth) return auth.response;
  try {
    const body = await readJsonObject(request, '无效的维护申请。');
    if (body.confirm !== true || !Array.isArray(body.recipientIds) || !body.recipientIds.length ||
      body.recipientIds.some((id) => !Number.isSafeInteger(id) || id <= 0))
      throw new HttpError(400, '请确认接收申请的维护者。');
    const application = await requestWorkMaintainer(runtime, auth.user, parsePositiveId(context.params.workId), body.recipientIds as number[]);
    return json({ ok: true, application });
  } catch (error) { return jsonError('提交维护申请失败', error); }
}
