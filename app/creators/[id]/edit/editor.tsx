import { CreatorLinksEditor } from "@/app/components/creators/creator-links-editor";
import { TokenPicker } from "@/app/components/pickers/token-picker";
import { normalizeEntityName } from "@/lib/entity-name";
import { AvatarCropper } from "@/app/components/ui/avatar-cropper";
import { BackLink } from "@/app/components/ui/back-link";
import { Button, buttonVariants } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { Notice } from "@/app/components/ui/notice";
import { Pane } from "@/app/components/ui/pane";
import { Textarea } from "@/app/components/ui/textarea";
import { useToast } from "@/app/components/ui/toast";
import { CREATOR_EDIT_LIMITS, creatorMetadataSnapshot, type CreatorMetadata } from "@/lib/creator-edit";
import { Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useBeforeUnload, useBlocker, useNavigate } from "react-router";

type EditableCreator = CreatorMetadata & { id: number; avatarBlobSha256: string | null };
type SaveResult = { ok: boolean; error?: string; detail?: string; code?: string };

export function CreatorEditor({ creator }: { creator: EditableCreator }) {
  const [result, setResult] = useState<SaveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const navigate = useNavigate();
  const toast = useToast();
  const [snapshot] = useState(() => creatorMetadataSnapshot(creator));
  const [name, setName] = useState(creator.name);
  const [aliases, setAliases] = useState(creator.aliases);
  const [aliasQuery, setAliasQuery] = useState("");
  const [links, setLinks] = useState(creator.links);
  const [bio, setBio] = useState(creator.bio ?? "");
  const redirected = useRef(false);
  const saved = result?.ok === true;
  const dirty = !saved && (Boolean(aliasQuery.trim()) || snapshot !== creatorMetadataSnapshot({ name, aliases, links, bio: bio || null }));
  const blocker = useBlocker(dirty || busy);
  const detailPath = `/creators/${creator.id}`;
  const failed = !busy && result && !result.ok;

  async function save(form: HTMLFormElement) {
    if (saving.current) return;
    const pendingAlias = normalizeEntityName(aliasQuery);
    if (pendingAlias.length > CREATOR_EDIT_LIMITS.name) {
      setResult({ ok: false, detail: `每个别名最多 ${CREATOR_EDIT_LIMITS.name} 字` });
      document.getElementById("creator-aliases")?.focus();
      return;
    }
    const body = new FormData(form);
    aliases.forEach((alias) => body.append("alias", alias));
    if (pendingAlias) body.append("alias", pendingAlias);
    saving.current = true;
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/creators/${creator.id}/update`, {
        method: "POST", credentials: "same-origin", body,
      });
      const data = await response.json() as SaveResult;
      const ok = response.ok && data.ok === true;
      if (!ok) toast.error(data.detail || "作者资料保存失败，你的输入已保留。");
      setResult(ok || data.code === "creator_edit_conflict" || data.error === "Authentication required"
        ? { ...data, ok }
        : null);
    } catch {
      toast.error("网络连接中断，暂时无法确认是否保存成功。你的输入已保留，请重试或查看作者资料。");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  useBeforeUnload((event) => {
    if (dirty || busy) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  useEffect(() => {
    if (!saved || busy || redirected.current) return;
    redirected.current = true;
    toast.success("作者资料已保存。");
    void navigate(detailPath);
  }, [saved, busy, navigate, detailPath, toast]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-10 pt-6">
      <BackLink className="min-h-9" href={detailPath} label="返回作者资料" variant="text" />
      <header className="mb-6 mt-2">
        <h1 className="font-serif text-3xl font-bold">编辑作者资料</h1>
      </header>

      <div className="mb-5">
        <Pane heading="作者头像">
          <fieldset disabled={busy}>
            <legend className="sr-only">作者头像</legend>
            <AvatarCropper allowDelete avatarBlobSha256={creator.avatarBlobSha256} displayName={name || creator.name}
              endpoint={`/api/creators/${creator.id}/avatar?previous=${creator.avatarBlobSha256 ?? "none"}`} shape="square" />
          </fieldset>
        </Pane>
      </div>

      <form method="post" action={`/api/creators/${creator.id}/update`} className="grid gap-5" aria-busy={busy} onSubmit={(event) => {
        event.preventDefault();
        void save(event.currentTarget);
      }}>
        <input name="snapshot" type="hidden" value={snapshot} />
        <fieldset disabled={busy || saved} className="min-w-0">
          <legend className="sr-only">作者资料</legend>
          <Pane heading="基本资料">
            <div className="grid gap-5">
              <FormField controlId="creator-name" label="作者名称">
                <Input id="creator-name" name="name" required maxLength={CREATOR_EDIT_LIMITS.name} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
              </FormField>

              <FormField controlId="creator-aliases" label="别名">
                <TokenPicker id="creator-aliases" label="别名" placeholder="添加别名"
                  values={aliases} onChange={setAliases} onQueryChange={setAliasQuery}
                  normalizeValue={normalizeEntityName} suggestions={[]} disabled={busy || saved}
                  showHelp={false} showSelectionCount={false} showRecommendations={false}
                  commitOnBlur validateValue={(value) => normalizeEntityName(value).length > CREATOR_EDIT_LIMITS.name ? `每个别名最多 ${CREATOR_EDIT_LIMITS.name} 字` : null} />
              </FormField>

              <CreatorLinksEditor initialLinks={creator.links} onChange={setLinks} disabled={busy || saved} />

              <FormField controlId="creator-bio" label="简介">
                <Textarea id="creator-bio" name="bio" rows={8} maxLength={CREATOR_EDIT_LIMITS.bio} value={bio} onChange={(event) => setBio(event.target.value)} />
              </FormField>
            </div>
          </Pane>
        </fieldset>

        {failed ? (
          <div className="grid gap-2">
            <Notice>{result?.detail || (result?.error === "Authentication required" ? "登录已失效，请重新登录后保存。你的输入已保留。" : result?.error === "Permission denied" ? "当前账号没有编辑作者资料的权限。你的输入已保留。" : "保存失败，你的输入已保留，请稍后重试。")}</Notice>
            {result?.code === "creator_edit_conflict" ? (
              <a className="text-sm text-primary underline" href={detailPath} target="_blank" rel="noreferrer">在新标签页查看最新作者资料</a>
            ) : null}
            {result?.error === "Authentication required" ? (
              <a className="text-sm text-primary underline" href={`/login?next=${encodeURIComponent(detailPath)}`} target="_blank" rel="noreferrer">在新标签页登录</a>
            ) : null}
          </div>
        ) : null}

        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="flex gap-2">
            <Link className={buttonVariants({ variant: "outline" })} to={detailPath}>返回</Link>
            <Button type="submit" disabled={busy || saved || !dirty}><Save aria-hidden />{busy ? "正在保存…" : "保存资料"}</Button>
          </div>
        </div>
      </form>

      <Dialog.Root open={blocker.state === "blocked"} onOpenChange={(open) => { if (!open && blocker.state === "blocked") blocker.reset(); }}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content className="left-1/2 top-1/2 grid w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg p-5">
            <Dialog.Title>{busy ? "资料正在保存" : "离开编辑页面？"}</Dialog.Title>
            <Dialog.Description className="text-sm text-muted">{busy ? "请等待保存完成。" : "尚未保存的资料修改会丢失；已单独保存的头像会保留。"}</Dialog.Description>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => { if (blocker.state === "blocked") blocker.reset(); }}>继续编辑</Button>
              {!busy ? <Button type="button" variant="destructive" onClick={() => { if (blocker.state === "blocked") blocker.proceed(); }}>放弃修改并离开</Button> : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}
