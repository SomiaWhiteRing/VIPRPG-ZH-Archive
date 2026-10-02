import { requireUser } from '@/app/.server/auth/guards';
import { addWorkMaintainer, canManageWorkMaintainers, listPublicWorkMaintainers, removeWorkMaintainer, searchWorkMaintainerCandidates } from '@/app/.server/db/work-maintainers';
import { parsePositiveId, readJsonObject } from '@/app/.server/http/request';
import type { AppRuntime } from '@/app/.server/runtime';
import { HttpError, json, jsonError } from '@/lib/http';

type Context = { params: { workId: string } };
export async function GET(runtime: AppRuntime, request: Request, context: Context) {
  const auth = await requireUser(runtime, request);
  if ('response' in auth) return auth.response;
  try {
    const workId = parsePositiveId(context.params.workId);
    const query = new URL(request.url).searchParams.get('q');
    if (!await canManageWorkMaintainers(runtime, workId, auth.user)) throw new HttpError(403, '没有管理此作品维护者的权限。');
    const users = query === null ? await listPublicWorkMaintainers(runtime, workId)
      : await searchWorkMaintainerCandidates(runtime, auth.user, workId, query);
    return json({ ok: true, users }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return jsonError('读取维护者失败', error); }
}

export async function POST(runtime: AppRuntime, request: Request, context: Context) {
  const auth = await requireUser(runtime, request);
  if ('response' in auth) return auth.response;
  try {
    const body = await readJsonObject(request, '无效的维护者操作。');
    if (body.confirm !== true || typeof body.userId !== 'number' || !Number.isSafeInteger(body.userId) || body.userId <= 0 ||
      (body.action !== 'add' && body.action !== 'remove')) throw new HttpError(400, '请选择用户并确认操作。');
    const workId = parsePositiveId(context.params.workId);
    if (body.action === 'remove') await removeWorkMaintainer(runtime, auth.user, workId, body.userId);
    else await addWorkMaintainer(runtime, auth.user, workId, body.userId);
    return json({ ok: true, users: await listPublicWorkMaintainers(runtime, workId) });
  } catch (error) { return jsonError('调整维护者失败', error); }
}
