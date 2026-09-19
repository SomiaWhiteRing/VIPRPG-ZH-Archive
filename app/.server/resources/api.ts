import { Hono } from "hono";
import { requireBootstrapAdmin } from "@/app/.server/auth/authorize";
import type { AppRuntime } from "@/app/.server/runtime";
import { blobKey } from "@/app/.server/storage/archive-keys";
import { HttpError, jsonError } from "@/lib/http";
import {
  createResource,
  editResource,
  integer,
  registerArtifact,
  type Actor,
} from "./mutations";
import { getArtifact, getEditor, getResource, listResources } from "./data";
import {
  cleanupArtifact,
  confirmArtifact,
  inspectStorage,
  readLimited,
  uploadArtifact,
  uploadIcon,
  verifyArtifactObject,
} from "./objects";
import { downloadArtifact, updateManifest } from "./public";

export const resourceApi = new Hono<{
  Bindings: CloudflareEnv;
  Variables: { runtime: AppRuntime };
}>();
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function body(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(415, "需要 JSON 请求");
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder().decode(await readLimited(request, 256 * 1024)),
    );
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "JSON 格式不正确");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "请求格式不正确");
  return value as Record<string, unknown>;
}
type Endpoint = (
  runtime: AppRuntime,
  request: Request,
  params: Record<string, string>,
  actor: Actor | null,
) => Promise<Response>;
function route(path: string, methods: string[], admin: boolean, run: Endpoint) {
  resourceApi.all(path, async (c) => {
    const allow = [...methods, "OPTIONS"].join(", ");
    if (c.req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: { Allow: allow } });
    if (!methods.includes(c.req.method))
      return new Response(null, { status: 405, headers: { Allow: allow } });
    try {
      const runtime = c.get("runtime");
      let actor: Actor | null = null;
      if (admin) {
        const auth = await requireBootstrapAdmin(runtime, c.req.raw);
        if ("response" in auth) return auth.response;
        actor = auth.user;
      }
      return await run(runtime, c.req.raw, c.req.param(), actor);
    } catch (error) {
      return jsonError("资源操作失败", error);
    }
  });
}
function root(actor: Actor | null): Actor {
  if (!actor) throw new HttpError(403, "需要超级管理员权限");
  return actor;
}
route(
  "/api/admin/resources",
  ["GET", "POST"],
  true,
  async (rt, req, _p, actor) => {
    if (req.method === "GET")
      return json({ resources: await listResources(rt, true) });
    const id = await createResource(rt, root(actor), await body(req));
    return json(await getEditor(rt, id), 201);
  },
);
route("/api/admin/resources/storage", ["GET"], true, async (rt, req) =>
  json(
    await inspectStorage(
      rt,
      new URL(req.url).searchParams.get("cursor") ?? undefined,
    ),
  ),
);
route(
  "/api/admin/resources/:id",
  ["GET", "POST"],
  true,
  async (rt, req, p, actor) => {
    if (req.method === "POST")
      await editResource(rt, root(actor), p.id, await body(req));
    return json(await getEditor(rt, p.id));
  },
);
route(
  "/api/admin/resources/:id/icon",
  ["GET", "HEAD", "PUT"],
  true,
  async (rt, req, p, actor) => {
    if (req.method === "PUT") {
      await uploadIcon(
        rt,
        root(actor),
        p.id,
        integer(Number(req.headers.get("x-resource-revision")), 1),
        req,
      );
      return json(await getEditor(rt, p.id));
    }
    const row = await getResource(rt, p.id);
    if (!row.icon_blob_sha256) throw new HttpError(404, "图标不存在");
    const object = await rt.bucket.get(blobKey(row.icon_blob_sha256));
    if (!object) throw new HttpError(404, "图标不存在");
    return new Response(req.method === "HEAD" ? null : object.body, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);
route(
  "/api/admin/resources/:id/artifacts",
  ["POST"],
  true,
  async (rt, req, p, actor) => {
    const artifactId = await registerArtifact(
      rt,
      root(actor),
      p.id,
      await body(req),
    );
    return json({ artifactId, ...(await getEditor(rt, p.id)) }, 201);
  },
);
route(
  "/api/admin/resource-artifacts/:id",
  ["PUT", "POST", "GET"],
  true,
  async (rt, req, p, actor) => {
    const row = await getArtifact(rt, p.id);
    if (req.method === "PUT")
      await uploadArtifact(
        rt,
        root(actor),
        p.id,
        integer(Number(req.headers.get("x-resource-revision")), 1),
        req,
      );
    else if (req.method === "POST") {
      const data = await body(req),
        revision = integer(data.revision, 1);
      if (data.action === "confirm")
        await confirmArtifact(rt, root(actor), p.id, revision);
      else if (data.action === "cleanup")
        await cleanupArtifact(rt, root(actor), p.id, revision);
      else throw new HttpError(400, "未知操作");
    } else if (row.storage_status === "ready")
      await verifyArtifactObject(rt, row);
    return json(await getEditor(rt, row.resource_id));
  },
);
route(
  "/api/tool-artifacts/:id/download",
  ["GET", "HEAD"],
  false,
  (rt, req, p) => downloadArtifact(rt, req, p.id),
);
route(
  "/api/tools/:slug/updates/:channel/:target",
  ["GET", "HEAD"],
  false,
  async (rt, req, p) => {
    const value = await updateManifest(
      rt,
      p.slug,
      p.channel,
      p.target,
      new URL(req.url).searchParams.get("applicationBuildId"),
    );
    return req.method === "HEAD"
      ? new Response(null, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        })
      : json(value);
  },
);
