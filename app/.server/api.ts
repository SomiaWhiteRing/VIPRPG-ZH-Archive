import { uploadCommentImage, readCommentImage } from "@/app/.server/comments/images";
import * as showcaseEndpoint from "@/app/.server/endpoints/api/account/showcase/route";
import * as creatorAvatarEndpoint from "@/app/.server/endpoints/api/creators/[creatorId]/avatar/route";
import * as creatorUpdateEndpoint from "@/app/.server/endpoints/api/creators/[creatorId]/update/route";
import * as workMediaEndpoint from "@/app/.server/endpoints/api/works/[workId]/media/[sha256]/route";
import * as endpoint0 from "@/app/.server/endpoints/api/account/avatar/route";
import * as endpoint1 from "@/app/.server/endpoints/api/account/delete/route";
import * as endpoint2 from "@/app/.server/endpoints/api/account/email/confirm/route";
import * as endpoint3 from "@/app/.server/endpoints/api/account/email/start/route";
import * as endpoint4 from "@/app/.server/endpoints/api/account/password/route";
import * as endpoint5 from "@/app/.server/endpoints/api/account/privacy/route";
import * as endpoint6 from "@/app/.server/endpoints/api/account/profile/route";
import * as endpoint7 from "@/app/.server/endpoints/api/account/request-upload-access/route";
import * as endpoint37 from "@/app/.server/endpoints/api/admin/archive-versions/[archiveVersionId]/current/route";
import * as endpoint38 from "@/app/.server/endpoints/api/admin/archive-versions/[archiveVersionId]/delete/route";
import * as endpoint39 from "@/app/.server/endpoints/api/admin/archive-versions/[archiveVersionId]/restore/route";
import * as endpoint40 from "@/app/.server/endpoints/api/admin/archive-versions/[archiveVersionId]/update/route";
import * as endpoint8 from "@/app/.server/endpoints/api/admin/character-index/route";
import * as endpoint41 from "@/app/.server/endpoints/api/admin/characters/[characterId]/face-sheets/route";
import * as endpoint42 from "@/app/.server/endpoints/api/admin/characters/[characterId]/materials/route";
import * as endpoint43 from "@/app/.server/endpoints/api/admin/characters/[characterId]/update/route";
import * as endpoint9 from "@/app/.server/endpoints/api/admin/characters/route";
import * as endpoint10 from "@/app/.server/endpoints/api/admin/consistency/route";
import * as endpoint44 from "@/app/.server/endpoints/api/admin/creators/[creatorId]/avatar/route";
import * as endpoint45 from "@/app/.server/endpoints/api/admin/creators/[creatorId]/merge/route";
import * as endpoint46 from "@/app/.server/endpoints/api/admin/creators/[creatorId]/update/route";
import * as endpoint11 from "@/app/.server/endpoints/api/admin/discussions/images/route";
import * as endpoint12 from "@/app/.server/endpoints/api/admin/discussions/route";
import * as endpoint13 from "@/app/.server/endpoints/api/admin/emojis/route";
import * as endpoint14 from "@/app/.server/endpoints/api/admin/gc/dry-run/route";
import * as endpoint15 from "@/app/.server/endpoints/api/admin/gc/sweep/route";
import * as endpoint16 from "@/app/.server/endpoints/api/admin/observability/route";
import * as endpoint47 from "@/app/.server/endpoints/api/admin/roles/[roleId]/permissions/route";
import * as endpoint48 from "@/app/.server/endpoints/api/admin/roles/[roleId]/route";
import * as endpoint17 from "@/app/.server/endpoints/api/admin/roles/route";
import * as endpoint18 from "@/app/.server/endpoints/api/admin/summary/route";
import * as endpoint49 from "@/app/.server/endpoints/api/admin/tags/[tagId]/update/route";
import * as endpoint50 from "@/app/.server/endpoints/api/admin/users/[userId]/roles/[roleId]/route";
import * as endpoint51 from "@/app/.server/endpoints/api/admin/users/[userId]/roles/route";
import * as endpoint52 from "@/app/.server/endpoints/api/admin/users/[userId]/status/route";
import * as endpoint53 from "@/app/.server/endpoints/api/admin/works/[workId]/maintainers/route";
import * as endpoint54 from "@/app/.server/endpoints/api/admin/works/[workId]/merge/route";
import * as endpoint55 from "@/app/.server/endpoints/api/admin/works/[workId]/update/route";
import * as endpoint56 from "@/app/.server/endpoints/api/archive-versions/[archiveVersionId]/web-play/route";
import * as endpoint19 from "@/app/.server/endpoints/api/auth/login/route";
import * as endpoint20 from "@/app/.server/endpoints/api/auth/logout/route";
import * as endpoint21 from "@/app/.server/endpoints/api/auth/password-reset/confirm/route";
import * as endpoint22 from "@/app/.server/endpoints/api/auth/password-reset/start/route";
import * as endpoint23 from "@/app/.server/endpoints/api/auth/register/start/route";
import * as endpoint24 from "@/app/.server/endpoints/api/auth/register/verify/route";
import * as endpoint57 from "@/app/.server/endpoints/api/blobs/[sha256]/route";
import * as endpoint58 from "@/app/.server/endpoints/api/catalogs/[id]/items/route";
import * as endpoint59 from "@/app/.server/endpoints/api/catalogs/[id]/route";
import * as endpoint25 from "@/app/.server/endpoints/api/catalogs/route";
import * as endpoint60 from "@/app/.server/endpoints/api/characters/[characterId]/comments/route";
import * as endpoint61 from "@/app/.server/endpoints/api/comments/[commentId]/like/route";
import * as endpoint62 from "@/app/.server/endpoints/api/comments/[commentId]/moderation/route";
import * as endpoint63 from "@/app/.server/endpoints/api/comments/[commentId]/replies/route";
import * as endpoint64 from "@/app/.server/endpoints/api/comments/[commentId]/route";
import * as endpoint65 from "@/app/.server/endpoints/api/core-packs/[sha256]/route";
import * as endpoint66 from "@/app/.server/endpoints/api/creators/[creatorId]/comments/route";
import * as endpoint67 from "@/app/.server/endpoints/api/discussions/images/[id]/route";
import * as endpoint26 from "@/app/.server/endpoints/api/discussions/images/route";
import * as endpoint27 from "@/app/.server/endpoints/api/discussions/route";
import * as endpoint28 from "@/app/.server/endpoints/api/health/db/route";
import * as endpoint29 from "@/app/.server/endpoints/api/health/r2/route";
import * as endpoint30 from "@/app/.server/endpoints/api/health/route";
import * as endpoint68 from "@/app/.server/endpoints/api/imports/[importJobId]/cancel/route";
import * as endpoint69 from "@/app/.server/endpoints/api/imports/[importJobId]/commit/route";
import * as endpoint70 from "@/app/.server/endpoints/api/imports/[importJobId]/fail/route";
import * as endpoint71 from "@/app/.server/endpoints/api/imports/[importJobId]/metadata-ready/route";
import * as endpoint72 from "@/app/.server/endpoints/api/imports/[importJobId]/preflight/route";
import * as endpoint73 from "@/app/.server/endpoints/api/imports/[importJobId]/resume/route";
import * as endpoint74 from "@/app/.server/endpoints/api/imports/[importJobId]/route";
import * as endpoint75 from "@/app/.server/endpoints/api/imports/[importJobId]/source-ready/route";
import * as endpoint31 from "@/app/.server/endpoints/api/imports/route";
import * as endpoint76 from "@/app/.server/endpoints/api/inbox/[itemId]/read/route";
import * as endpoint77 from "@/app/.server/endpoints/api/inbox/[itemId]/resolve/route";
import * as endpoint32 from "@/app/.server/endpoints/api/inbox/read-all/route";
import * as endpoint33 from "@/app/.server/endpoints/api/inbox/unread/route";
import * as endpoint78 from "@/app/.server/endpoints/api/media/blobs/[sha256]/route";
import * as endpoint79 from "@/app/.server/endpoints/api/translation-relations/[relationId]/route";
import * as endpoint80 from "@/app/.server/endpoints/api/work-relations/[relationId]/route";
import * as endpoint81 from "@/app/.server/endpoints/api/works/[workId]/comments/route";
import * as endpoint82 from "@/app/.server/endpoints/api/works/[workId]/delete/route";
import * as endpoint83 from "@/app/.server/endpoints/api/works/[workId]/me/route";
import * as endpoint84 from "@/app/.server/endpoints/api/works/[workId]/owned/route";
import * as endpoint85 from "@/app/.server/endpoints/api/works/[workId]/played/route";
import * as endpoint86 from "@/app/.server/endpoints/api/works/[workId]/relations/route";
import * as endpoint87 from "@/app/.server/endpoints/api/works/[workId]/translation-relations/route";
import * as endpoint88 from "@/app/.server/endpoints/api/works/[workId]/view/route";
import * as endpoint34 from "@/app/.server/endpoints/api/works/external/route";
import * as endpoint35 from "@/app/.server/endpoints/api/works/lookup/route";
import * as endpoint36 from "@/app/.server/endpoints/discussions/sitemap.xml/route";
import * as endpoint89 from "@/app/.server/endpoints/discussions/sitemaps/[shard]/route";
import { jsonError } from "@/lib/http";
import { Hono } from "hono";
import type { AppRuntime } from "./runtime";
import { emojiApi } from "./emojis/api";
import { resourceApi } from "./resources/api";

export const api = new Hono<{
  Bindings: CloudflareEnv;
  Variables: { runtime: AppRuntime };
}>();
api.onError((error) => jsonError("请求失败", error));
api.post("/api/comments/images", (c) => uploadCommentImage(c.get("runtime"), c.req.raw));
api.on(["GET", "HEAD"], "/api/comments/images/:id", (c) => readCommentImage(c.get("runtime"), c.req.param("id")));
api.options("/api/comments/images", (c) => c.body(null, 204, { Allow: "POST, OPTIONS" }));
api.all("/api/comments/images", (c) => c.json({ ok: false, error: "Method not allowed" }, 405, { Allow: "POST, OPTIONS" }));
api.options("/api/comments/images/:id", (c) => c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }));
api.all("/api/comments/images/:id", (c) => c.json({ ok: false, error: "Method not allowed" }, 405, { Allow: "GET, HEAD, OPTIONS" }));

api.on(["GET", "HEAD"], "/api/works/:workId/media/:sha256", (c) =>
  workMediaEndpoint.GET(c.get("runtime"), c.req.raw, { params: {workId: c.req.param("workId"), sha256: c.req.param("sha256")} }));
api.all("/api/works/:workId/media/:sha256", (c) => c.json({ok:false,error:"Method not allowed"},405,{Allow:"GET, HEAD"}));
api.route("/", resourceApi);
api.route("/", emojiApi);
api.on(["GET", "HEAD"], "/api/account/showcase", (c) =>
  showcaseEndpoint.GET(c.get("runtime"), c.req.raw),
);
api.on("PUT", "/api/account/showcase", (c) =>
  showcaseEndpoint.PUT(c.get("runtime"), c.req.raw),
);
api.options("/api/account/showcase", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, PUT, OPTIONS" }),
);
api.all("/api/account/showcase", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, { Allow: "GET, HEAD, PUT, OPTIONS" }),
);
api.on("PUT", "/api/account/avatar", (c) =>
  endpoint0.PUT(c.get("runtime"), c.req.raw),
);
api.on("DELETE", "/api/account/avatar", (c) =>
  endpoint0.DELETE(c.get("runtime"), c.req.raw),
);
api.options("/api/account/avatar", (c) =>
  c.body(null, 204, { Allow: "PUT, DELETE, OPTIONS" }),
);
api.all("/api/account/avatar", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "PUT, DELETE, OPTIONS",
  }),
);
api.on("POST", "/api/account/delete", (c) =>
  endpoint1.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/account/delete", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/account/delete", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/account/email/confirm", (c) =>
  endpoint2.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/account/email/confirm", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/account/email/confirm", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/account/email/start", (c) =>
  endpoint3.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/account/email/start", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/account/email/start", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/account/password", (c) =>
  endpoint4.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/account/password", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/account/password", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/account/privacy", (c) =>
  endpoint5.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/account/privacy", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/account/privacy", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/account/profile", (c) =>
  endpoint6.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/account/profile", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/account/profile", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/account/request-upload-access", (c) =>
  endpoint7.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/account/request-upload-access", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/account/request-upload-access", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/admin/character-index", (c) =>
  endpoint8.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/admin/character-index", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/character-index", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/admin/characters", (c) =>
  endpoint9.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/admin/characters", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/characters", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/admin/consistency", (c) =>
  endpoint10.GET(c.get("runtime"), c.req.raw),
);
api.options("/api/admin/consistency", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }),
);
api.all("/api/admin/consistency", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, HEAD, OPTIONS",
  }),
);
api.on("POST", "/api/admin/discussions/images", (c) =>
  endpoint11.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/admin/discussions/images", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/discussions/images", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/admin/discussions", (c) =>
  endpoint12.GET(c.get("runtime"), c.req.raw),
);
api.on("POST", "/api/admin/discussions", (c) =>
  endpoint12.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/admin/discussions", (c) =>
  c.body(null, 204, { Allow: "GET, POST, HEAD, OPTIONS" }),
);
api.all("/api/admin/discussions", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, POST, HEAD, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/admin/emojis", (c) =>
  endpoint13.GET(c.get("runtime"), c.req.raw),
);
api.on("POST", "/api/admin/emojis", (c) =>
  endpoint13.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/admin/emojis", (c) =>
  c.body(null, 204, { Allow: "GET, POST, HEAD, OPTIONS" }),
);
api.all("/api/admin/emojis", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, POST, HEAD, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/admin/gc/dry-run", (c) =>
  endpoint14.GET(c.get("runtime"), c.req.raw),
);
api.options("/api/admin/gc/dry-run", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }),
);
api.all("/api/admin/gc/dry-run", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, HEAD, OPTIONS",
  }),
);
api.on("POST", "/api/admin/gc/sweep", (c) =>
  endpoint15.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/admin/gc/sweep", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/gc/sweep", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/admin/observability", (c) =>
  endpoint16.GET(c.get("runtime"), c.req.raw),
);
api.options("/api/admin/observability", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }),
);
api.all("/api/admin/observability", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, HEAD, OPTIONS",
  }),
);
api.on("POST", "/api/admin/roles", (c) =>
  endpoint17.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/admin/roles", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/roles", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/admin/summary", (c) =>
  endpoint18.GET(c.get("runtime"), c.req.raw),
);
api.options("/api/admin/summary", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }),
);
api.all("/api/admin/summary", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, HEAD, OPTIONS",
  }),
);
api.on("POST", "/api/auth/login", (c) =>
  endpoint19.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/auth/login", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/auth/login", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/auth/logout", (c) =>
  endpoint20.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/auth/logout", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/auth/logout", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/auth/password-reset/confirm", (c) =>
  endpoint21.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/auth/password-reset/confirm", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/auth/password-reset/confirm", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/auth/password-reset/start", (c) =>
  endpoint22.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/auth/password-reset/start", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/auth/password-reset/start", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/auth/register/start", (c) =>
  endpoint23.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/auth/register/start", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/auth/register/start", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/auth/register/verify", (c) =>
  endpoint24.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/auth/register/verify", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/auth/register/verify", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/catalogs", (c) =>
  endpoint25.GET(c.get("runtime"), c.req.raw),
);
api.on("POST", "/api/catalogs", (c) =>
  endpoint25.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/catalogs", (c) =>
  c.body(null, 204, { Allow: "GET, POST, HEAD, OPTIONS" }),
);
api.all("/api/catalogs", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, POST, HEAD, OPTIONS",
  }),
);
api.on("POST", "/api/discussions/images", (c) =>
  endpoint26.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/discussions/images", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/discussions/images", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/discussions", (c) =>
  endpoint27.GET(c.get("runtime"), c.req.raw),
);
api.on("POST", "/api/discussions", (c) =>
  endpoint27.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/discussions", (c) =>
  c.body(null, 204, { Allow: "GET, POST, HEAD, OPTIONS" }),
);
api.all("/api/discussions", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, POST, HEAD, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/health/db", (c) =>
  endpoint28.GET(c.get("runtime")),
);
api.options("/api/health/db", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }),
);
api.all("/api/health/db", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, HEAD, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/health/r2", (c) =>
  endpoint29.GET(c.get("runtime")),
);
api.options("/api/health/r2", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }),
);
api.all("/api/health/r2", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, HEAD, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/health", (c) => endpoint30.GET(c.get("runtime")));
api.options("/api/health", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }),
);
api.all("/api/health", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, HEAD, OPTIONS",
  }),
);
api.on("POST", "/api/imports", (c) =>
  endpoint31.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/imports", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/imports", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/inbox/read-all", (c) =>
  endpoint32.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/inbox/read-all", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/inbox/read-all", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/inbox/unread", (c) =>
  endpoint33.GET(c.get("runtime"), c.req.raw),
);
api.options("/api/inbox/unread", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }),
);
api.all("/api/inbox/unread", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, HEAD, OPTIONS",
  }),
);
api.on("POST", "/api/works/external", (c) =>
  endpoint34.POST(c.get("runtime"), c.req.raw),
);
api.options("/api/works/external", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/works/external", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/works/lookup", (c) =>
  endpoint35.GET(c.get("runtime"), c.req.raw),
);
api.options("/api/works/lookup", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }),
);
api.all("/api/works/lookup", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, HEAD, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/discussions/sitemap.xml", (c) =>
  endpoint36.GET(c.get("runtime")),
);
api.options("/discussions/sitemap.xml", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }),
);
api.all("/discussions/sitemap.xml", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, HEAD, OPTIONS",
  }),
);
api.on("POST", "/api/admin/archive-versions/:archiveVersionId/current", (c) =>
  endpoint37.POST(c.get("runtime"), c.req.raw, {
    params: { archiveVersionId: c.req.param("archiveVersionId") },
  }),
);
api.options("/api/admin/archive-versions/:archiveVersionId/current", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/archive-versions/:archiveVersionId/current", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/admin/archive-versions/:archiveVersionId/delete", (c) =>
  endpoint38.POST(c.get("runtime"), c.req.raw, {
    params: { archiveVersionId: c.req.param("archiveVersionId") },
  }),
);
api.options("/api/admin/archive-versions/:archiveVersionId/delete", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/archive-versions/:archiveVersionId/delete", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/admin/archive-versions/:archiveVersionId/restore", (c) =>
  endpoint39.POST(c.get("runtime"), c.req.raw, {
    params: { archiveVersionId: c.req.param("archiveVersionId") },
  }),
);
api.options("/api/admin/archive-versions/:archiveVersionId/restore", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/archive-versions/:archiveVersionId/restore", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/admin/archive-versions/:archiveVersionId/update", (c) =>
  endpoint40.POST(c.get("runtime"), c.req.raw, {
    params: { archiveVersionId: c.req.param("archiveVersionId") },
  }),
);
api.options("/api/admin/archive-versions/:archiveVersionId/update", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/archive-versions/:archiveVersionId/update", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/admin/characters/:characterId/face-sheets", (c) =>
  endpoint41.POST(c.get("runtime"), c.req.raw, {
    params: { characterId: c.req.param("characterId") },
  }),
);
api.options("/api/admin/characters/:characterId/face-sheets", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/characters/:characterId/face-sheets", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/admin/characters/:characterId/materials", (c) =>
  endpoint42.GET(c.get("runtime"), c.req.raw, {
    params: { characterId: c.req.param("characterId") },
  }),
);
api.on("POST", "/api/admin/characters/:characterId/materials", (c) =>
  endpoint42.POST(c.get("runtime"), c.req.raw, {
    params: { characterId: c.req.param("characterId") },
  }),
);
api.on("PUT", "/api/admin/characters/:characterId/materials", (c) =>
  endpoint42.PUT(c.get("runtime"), c.req.raw, {
    params: { characterId: c.req.param("characterId") },
  }),
);
api.options("/api/admin/characters/:characterId/materials", (c) =>
  c.body(null, 204, { Allow: "GET, POST, PUT, HEAD, OPTIONS" }),
);
api.all("/api/admin/characters/:characterId/materials", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, POST, PUT, HEAD, OPTIONS",
  }),
);
api.on("POST", "/api/admin/characters/:characterId/update", (c) =>
  endpoint43.POST(c.get("runtime"), c.req.raw, {
    params: { characterId: c.req.param("characterId") },
  }),
);
api.options("/api/admin/characters/:characterId/update", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/characters/:characterId/update", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("PUT", "/api/admin/creators/:creatorId/avatar", (c) =>
  endpoint44.PUT(c.get("runtime"), c.req.raw, {
    params: { creatorId: c.req.param("creatorId") },
  }),
);
api.on("DELETE", "/api/admin/creators/:creatorId/avatar", (c) =>
  endpoint44.DELETE(c.get("runtime"), c.req.raw, {
    params: { creatorId: c.req.param("creatorId") },
  }),
);
api.options("/api/admin/creators/:creatorId/avatar", (c) =>
  c.body(null, 204, { Allow: "PUT, DELETE, OPTIONS" }),
);
api.all("/api/admin/creators/:creatorId/avatar", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "PUT, DELETE, OPTIONS",
  }),
);
api.on("POST", "/api/admin/creators/:creatorId/merge", (c) =>
  endpoint45.POST(c.get("runtime"), c.req.raw, {
    params: { creatorId: c.req.param("creatorId") },
  }),
);
api.options("/api/admin/creators/:creatorId/merge", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/creators/:creatorId/merge", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/admin/creators/:creatorId/update", (c) =>
  endpoint46.POST(c.get("runtime"), c.req.raw, {
    params: { creatorId: c.req.param("creatorId") },
  }),
);
api.options("/api/admin/creators/:creatorId/update", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/creators/:creatorId/update", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/admin/roles/:roleId/permissions", (c) =>
  endpoint47.POST(c.get("runtime"), c.req.raw, {
    params: { roleId: c.req.param("roleId") },
  }),
);
api.options("/api/admin/roles/:roleId/permissions", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/roles/:roleId/permissions", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("PATCH", "/api/admin/roles/:roleId", (c) =>
  endpoint48.PATCH(c.get("runtime"), c.req.raw, {
    params: { roleId: c.req.param("roleId") },
  }),
);
api.options("/api/admin/roles/:roleId", (c) =>
  c.body(null, 204, { Allow: "PATCH, OPTIONS" }),
);
api.all("/api/admin/roles/:roleId", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "PATCH, OPTIONS",
  }),
);
api.on("POST", "/api/admin/tags/:tagId/update", (c) =>
  endpoint49.POST(c.get("runtime"), c.req.raw, {
    params: { tagId: c.req.param("tagId") },
  }),
);
api.options("/api/admin/tags/:tagId/update", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/tags/:tagId/update", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("DELETE", "/api/admin/users/:userId/roles/:roleId", (c) =>
  endpoint50.DELETE(c.get("runtime"), c.req.raw, {
    params: { userId: c.req.param("userId"), roleId: c.req.param("roleId") },
  }),
);
api.options("/api/admin/users/:userId/roles/:roleId", (c) =>
  c.body(null, 204, { Allow: "DELETE, OPTIONS" }),
);
api.all("/api/admin/users/:userId/roles/:roleId", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "DELETE, OPTIONS",
  }),
);
api.on("POST", "/api/admin/users/:userId/roles", (c) =>
  endpoint51.POST(c.get("runtime"), c.req.raw, {
    params: { userId: c.req.param("userId") },
  }),
);
api.options("/api/admin/users/:userId/roles", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/users/:userId/roles", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/admin/users/:userId/status", (c) =>
  endpoint52.POST(c.get("runtime"), c.req.raw, {
    params: { userId: c.req.param("userId") },
  }),
);
api.options("/api/admin/users/:userId/status", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/users/:userId/status", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/admin/works/:workId/maintainers", (c) =>
  endpoint53.POST(c.get("runtime"), c.req.raw, {
    params: { workId: c.req.param("workId") },
  }),
);
api.options("/api/admin/works/:workId/maintainers", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/works/:workId/maintainers", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/admin/works/:workId/merge", (c) =>
  endpoint54.POST(c.get("runtime"), c.req.raw, {
    params: { workId: c.req.param("workId") },
  }),
);
api.options("/api/admin/works/:workId/merge", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/works/:workId/merge", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/admin/works/:workId/update", (c) =>
  endpoint55.POST(c.get("runtime"), c.req.raw, {
    params: { workId: c.req.param("workId") },
  }),
);
api.options("/api/admin/works/:workId/update", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/admin/works/:workId/update", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on(
  ["GET", "HEAD"],
  "/api/archive-versions/:archiveVersionId/web-play",
  (c) =>
    endpoint56.GET(c.get("runtime"), c.req.raw, {
      params: { archiveVersionId: c.req.param("archiveVersionId") },
    }),
);
api.options("/api/archive-versions/:archiveVersionId/web-play", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }),
);
api.all("/api/archive-versions/:archiveVersionId/web-play", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, HEAD, OPTIONS",
  }),
);
api.on("PUT", "/api/blobs/:sha256", (c) =>
  endpoint57.PUT(c.get("runtime"), c.req.raw, {
    params: { sha256: c.req.param("sha256") },
  }),
);
api.options("/api/blobs/:sha256", (c) =>
  c.body(null, 204, { Allow: "PUT, OPTIONS" }),
);
api.all("/api/blobs/:sha256", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "PUT, OPTIONS",
  }),
);
api.on("POST", "/api/catalogs/:id/items", (c) =>
  endpoint58.POST(c.get("runtime"), c.req.raw, {
    params: { id: c.req.param("id") },
  }),
);
api.on("PATCH", "/api/catalogs/:id/items", (c) =>
  endpoint58.PATCH(c.get("runtime"), c.req.raw, {
    params: { id: c.req.param("id") },
  }),
);
api.on("DELETE", "/api/catalogs/:id/items", (c) =>
  endpoint58.DELETE(c.get("runtime"), c.req.raw, {
    params: { id: c.req.param("id") },
  }),
);
api.options("/api/catalogs/:id/items", (c) =>
  c.body(null, 204, { Allow: "POST, PATCH, DELETE, OPTIONS" }),
);
api.all("/api/catalogs/:id/items", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, PATCH, DELETE, OPTIONS",
  }),
);
api.on("PATCH", "/api/catalogs/:id", (c) =>
  endpoint59.PATCH(c.get("runtime"), c.req.raw, {
    params: { id: c.req.param("id") },
  }),
);
api.on("DELETE", "/api/catalogs/:id", (c) =>
  endpoint59.DELETE(c.get("runtime"), c.req.raw, {
    params: { id: c.req.param("id") },
  }),
);
api.options("/api/catalogs/:id", (c) =>
  c.body(null, 204, { Allow: "PATCH, DELETE, OPTIONS" }),
);
api.all("/api/catalogs/:id", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "PATCH, DELETE, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/characters/:characterId/comments", (c) =>
  endpoint60.GET(c.get("runtime"), c.req.raw, {
    params: { characterId: c.req.param("characterId") },
  }),
);
api.on("POST", "/api/characters/:characterId/comments", (c) =>
  endpoint60.POST(c.get("runtime"), c.req.raw, {
    params: { characterId: c.req.param("characterId") },
  }),
);
api.options("/api/characters/:characterId/comments", (c) =>
  c.body(null, 204, { Allow: "GET, POST, HEAD, OPTIONS" }),
);
api.all("/api/characters/:characterId/comments", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, POST, HEAD, OPTIONS",
  }),
);
api.on("PUT", "/api/comments/:commentId/like", (c) =>
  endpoint61.PUT(c.get("runtime"), c.req.raw, {
    params: { commentId: c.req.param("commentId") },
  }),
);
api.on("DELETE", "/api/comments/:commentId/like", (c) =>
  endpoint61.DELETE(c.get("runtime"), c.req.raw, {
    params: { commentId: c.req.param("commentId") },
  }),
);
api.options("/api/comments/:commentId/like", (c) =>
  c.body(null, 204, { Allow: "PUT, DELETE, OPTIONS" }),
);
api.all("/api/comments/:commentId/like", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "PUT, DELETE, OPTIONS",
  }),
);
api.on("PATCH", "/api/comments/:commentId/moderation", (c) =>
  endpoint62.PATCH(c.get("runtime"), c.req.raw, {
    params: { commentId: c.req.param("commentId") },
  }),
);
api.options("/api/comments/:commentId/moderation", (c) =>
  c.body(null, 204, { Allow: "PATCH, OPTIONS" }),
);
api.all("/api/comments/:commentId/moderation", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "PATCH, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/comments/:commentId/replies", (c) =>
  endpoint63.GET(c.get("runtime"), c.req.raw, {
    params: { commentId: c.req.param("commentId") },
  }),
);
api.options("/api/comments/:commentId/replies", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }),
);
api.all("/api/comments/:commentId/replies", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, HEAD, OPTIONS",
  }),
);
api.on("PATCH", "/api/comments/:commentId", (c) =>
  endpoint64.PATCH(c.get("runtime"), c.req.raw, {
    params: { commentId: c.req.param("commentId") },
  }),
);
api.on("DELETE", "/api/comments/:commentId", (c) =>
  endpoint64.DELETE(c.get("runtime"), c.req.raw, {
    params: { commentId: c.req.param("commentId") },
  }),
);
api.options("/api/comments/:commentId", (c) =>
  c.body(null, 204, { Allow: "PATCH, DELETE, OPTIONS" }),
);
api.all("/api/comments/:commentId", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "PATCH, DELETE, OPTIONS",
  }),
);
api.on("PUT", "/api/core-packs/:sha256", (c) =>
  endpoint65.PUT(c.get("runtime"), c.req.raw, {
    params: { sha256: c.req.param("sha256") },
  }),
);
api.options("/api/core-packs/:sha256", (c) =>
  c.body(null, 204, { Allow: "PUT, OPTIONS" }),
);
api.all("/api/core-packs/:sha256", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "PUT, OPTIONS",
  }),
);
api.on("PUT", "/api/creators/:creatorId/avatar", (c) =>
  creatorAvatarEndpoint.PUT(c.get("runtime"), c.req.raw, { params: { creatorId: c.req.param("creatorId") } }),
);
api.on("DELETE", "/api/creators/:creatorId/avatar", (c) =>
  creatorAvatarEndpoint.DELETE(c.get("runtime"), c.req.raw, { params: { creatorId: c.req.param("creatorId") } }),
);
api.options("/api/creators/:creatorId/avatar", (c) => c.body(null, 204, { Allow: "PUT, DELETE, OPTIONS" }));
api.all("/api/creators/:creatorId/avatar", (c) => c.json({ ok: false, error: "Method not allowed" }, 405, { Allow: "PUT, DELETE, OPTIONS" }));
api.on("POST", "/api/creators/:creatorId/update", (c) =>
  creatorUpdateEndpoint.POST(c.get("runtime"), c.req.raw, { params: { creatorId: c.req.param("creatorId") } }),
);
api.options("/api/creators/:creatorId/update", (c) => c.body(null, 204, { Allow: "POST, OPTIONS" }));
api.all("/api/creators/:creatorId/update", (c) => c.json({ ok: false, error: "Method not allowed" }, 405, { Allow: "POST, OPTIONS" }));
api.on(["GET", "HEAD"], "/api/creators/:creatorId/comments", (c) =>
  endpoint66.GET(c.get("runtime"), c.req.raw, {
    params: { creatorId: c.req.param("creatorId") },
  }),
);
api.on("POST", "/api/creators/:creatorId/comments", (c) =>
  endpoint66.POST(c.get("runtime"), c.req.raw, {
    params: { creatorId: c.req.param("creatorId") },
  }),
);
api.options("/api/creators/:creatorId/comments", (c) =>
  c.body(null, 204, { Allow: "GET, POST, HEAD, OPTIONS" }),
);
api.all("/api/creators/:creatorId/comments", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, POST, HEAD, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/discussions/images/:id", (c) =>
  endpoint67.GET(c.get("runtime"), c.req.raw, {
    params: { id: c.req.param("id") },
  }),
);
api.options("/api/discussions/images/:id", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }),
);
api.all("/api/discussions/images/:id", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, HEAD, OPTIONS",
  }),
);
api.on("POST", "/api/imports/:importJobId/cancel", (c) =>
  endpoint68.POST(c.get("runtime"), c.req.raw, {
    params: { importJobId: c.req.param("importJobId") },
  }),
);
api.options("/api/imports/:importJobId/cancel", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/imports/:importJobId/cancel", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/imports/:importJobId/commit", (c) =>
  endpoint69.POST(c.get("runtime"), c.req.raw, {
    params: { importJobId: c.req.param("importJobId") },
  }),
);
api.options("/api/imports/:importJobId/commit", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/imports/:importJobId/commit", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/imports/:importJobId/fail", (c) =>
  endpoint70.POST(c.get("runtime"), c.req.raw, {
    params: { importJobId: c.req.param("importJobId") },
  }),
);
api.options("/api/imports/:importJobId/fail", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/imports/:importJobId/fail", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/imports/:importJobId/metadata-ready", (c) =>
  endpoint71.POST(c.get("runtime"), c.req.raw, {
    params: { importJobId: c.req.param("importJobId") },
  }),
);
api.options("/api/imports/:importJobId/metadata-ready", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/imports/:importJobId/metadata-ready", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/imports/:importJobId/preflight", (c) =>
  endpoint72.POST(c.get("runtime"), c.req.raw, {
    params: { importJobId: c.req.param("importJobId") },
  }),
);
api.options("/api/imports/:importJobId/preflight", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/imports/:importJobId/preflight", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/imports/:importJobId/resume", (c) =>
  endpoint73.POST(c.get("runtime"), c.req.raw, {
    params: { importJobId: c.req.param("importJobId") },
  }),
);
api.options("/api/imports/:importJobId/resume", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/imports/:importJobId/resume", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/imports/:importJobId", (c) =>
  endpoint74.GET(c.get("runtime"), c.req.raw, {
    params: { importJobId: c.req.param("importJobId") },
  }),
);
api.options("/api/imports/:importJobId", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }),
);
api.all("/api/imports/:importJobId", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, HEAD, OPTIONS",
  }),
);
api.on("POST", "/api/imports/:importJobId/source-ready", (c) =>
  endpoint75.POST(c.get("runtime"), c.req.raw, {
    params: { importJobId: c.req.param("importJobId") },
  }),
);
api.options("/api/imports/:importJobId/source-ready", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/imports/:importJobId/source-ready", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/inbox/:itemId/read", (c) =>
  endpoint76.POST(c.get("runtime"), c.req.raw, {
    params: { itemId: c.req.param("itemId") },
  }),
);
api.options("/api/inbox/:itemId/read", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/inbox/:itemId/read", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/inbox/:itemId/resolve", (c) =>
  endpoint77.POST(c.get("runtime"), c.req.raw, {
    params: { itemId: c.req.param("itemId") },
  }),
);
api.options("/api/inbox/:itemId/resolve", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/inbox/:itemId/resolve", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/media/blobs/:sha256", (c) =>
  endpoint78.GET(c.get("runtime"), c.req.raw, {
    params: { sha256: c.req.param("sha256") },
  }),
);
api.options("/api/media/blobs/:sha256", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }),
);
api.all("/api/media/blobs/:sha256", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, HEAD, OPTIONS",
  }),
);
api.on("DELETE", "/api/translation-relations/:relationId", (c) =>
  endpoint79.DELETE(c.get("runtime"), c.req.raw, {
    params: { relationId: c.req.param("relationId") },
  }),
);
api.options("/api/translation-relations/:relationId", (c) =>
  c.body(null, 204, { Allow: "DELETE, OPTIONS" }),
);
api.all("/api/translation-relations/:relationId", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "DELETE, OPTIONS",
  }),
);
api.on("DELETE", "/api/work-relations/:relationId", (c) =>
  endpoint80.DELETE(c.get("runtime"), c.req.raw, {
    params: { relationId: c.req.param("relationId") },
  }),
);
api.on("PATCH", "/api/work-relations/:relationId", (c) =>
  endpoint80.PATCH(c.get("runtime"), c.req.raw, {
    params: { relationId: c.req.param("relationId") },
  }),
);
api.options("/api/work-relations/:relationId", (c) =>
  c.body(null, 204, { Allow: "DELETE, PATCH, OPTIONS" }),
);
api.all("/api/work-relations/:relationId", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "DELETE, PATCH, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/api/works/:workId/comments", (c) =>
  endpoint81.GET(c.get("runtime"), c.req.raw, {
    params: { workId: c.req.param("workId") },
  }),
);
api.on("POST", "/api/works/:workId/comments", (c) =>
  endpoint81.POST(c.get("runtime"), c.req.raw, {
    params: { workId: c.req.param("workId") },
  }),
);
api.options("/api/works/:workId/comments", (c) =>
  c.body(null, 204, { Allow: "GET, POST, HEAD, OPTIONS" }),
);
api.all("/api/works/:workId/comments", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, POST, HEAD, OPTIONS",
  }),
);
api.on("POST", "/api/works/:workId/delete", (c) =>
  endpoint82.POST(c.get("runtime"), c.req.raw, {
    params: { workId: c.req.param("workId") },
  }),
);
api.options("/api/works/:workId/delete", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/works/:workId/delete", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("PATCH", "/api/works/:workId/me", (c) =>
  endpoint83.PATCH(c.get("runtime"), c.req.raw, {
    params: { workId: c.req.param("workId") },
  }),
);
api.options("/api/works/:workId/me", (c) =>
  c.body(null, 204, { Allow: "PATCH, OPTIONS" }),
);
api.all("/api/works/:workId/me", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "PATCH, OPTIONS",
  }),
);
api.on("POST", "/api/works/:workId/owned", (c) =>
  endpoint84.POST(c.get("runtime"), c.req.raw, {
    params: { workId: c.req.param("workId") },
  }),
);
api.options("/api/works/:workId/owned", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/works/:workId/owned", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/works/:workId/played", (c) =>
  endpoint85.POST(c.get("runtime"), c.req.raw, {
    params: { workId: c.req.param("workId") },
  }),
);
api.options("/api/works/:workId/played", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/works/:workId/played", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/works/:workId/relations", (c) =>
  endpoint86.POST(c.get("runtime"), c.req.raw, {
    params: { workId: c.req.param("workId") },
  }),
);
api.options("/api/works/:workId/relations", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/works/:workId/relations", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/works/:workId/translation-relations", (c) =>
  endpoint87.POST(c.get("runtime"), c.req.raw, {
    params: { workId: c.req.param("workId") },
  }),
);
api.options("/api/works/:workId/translation-relations", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/works/:workId/translation-relations", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on("POST", "/api/works/:workId/view", (c) =>
  endpoint88.POST(c.get("runtime"), c.req.raw, {
    params: { workId: c.req.param("workId") },
  }),
);
api.options("/api/works/:workId/view", (c) =>
  c.body(null, 204, { Allow: "POST, OPTIONS" }),
);
api.all("/api/works/:workId/view", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "POST, OPTIONS",
  }),
);
api.on(["GET", "HEAD"], "/discussions/sitemaps/:shard", (c) =>
  endpoint89.GET(c.get("runtime"), c.req.raw, {
    params: { shard: c.req.param("shard") },
  }),
);
api.options("/discussions/sitemaps/:shard", (c) =>
  c.body(null, 204, { Allow: "GET, HEAD, OPTIONS" }),
);
api.all("/discussions/sitemaps/:shard", (c) =>
  c.json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET, HEAD, OPTIONS",
  }),
);

api.all("/api/*", (c) => c.json({ ok: false, error: "Not found" }, 404));
