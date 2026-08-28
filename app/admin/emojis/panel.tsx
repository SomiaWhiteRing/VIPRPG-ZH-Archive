"use client";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { CustomEmojiDto } from "@/lib/server/db/work-community";

export function EmojiAdminPanel() {
  const [emojis, setEmojis] = useState<CustomEmojiDto[]>([]);
  const [shortcode, setShortcode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("站点");
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/admin/emojis", { credentials: "same-origin" });
    const body = (await response.json()) as { emojis?: CustomEmojiDto[] };
    if (response.ok) setEmojis(body.emojis ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/emojis", { credentials: "same-origin" })
      .then(async (response) => ({ response, body: (await response.json()) as { emojis?: CustomEmojiDto[] } }))
      .then(({ response, body }) => {
        if (!cancelled && response.ok) setEmojis(body.emojis ?? []);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  async function upload() {
    if (!file || !shortcode.trim() || !name.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("shortcode", shortcode);
      form.set("name", name);
      form.set("category", category);
      const response = await fetch("/api/admin/emojis", { method: "POST", body: form, credentials: "same-origin" });
      const body = (await response.json()) as { ok?: boolean; detail?: string };
      if (!response.ok || !body.ok) throw new Error(body.detail ?? "上传失败");
      setShortcode(""); setName(""); setFile(null); setMessage("表情已上传。");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "上传失败。"); }
    finally { setBusy(false); }
  }

  async function toggle(emoji: CustomEmojiDto) {
    const response = await fetch("/api/admin/emojis", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: emoji.id, status: emoji.status === "active" ? "retired" : "active" }),
    });
    if (response.ok) await load();
  }

  return <div className="grid gap-5">
    <section className="grid gap-3 rounded-md border border-border bg-muted/10 p-4">
      <h2>上传表情</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input placeholder="shortcode" value={shortcode} onChange={(event) => setShortcode(event.target.value)} />
        <Input placeholder="名称" value={name} onChange={(event) => setName(event.target.value)} />
        <Input placeholder="分类" value={category} onChange={(event) => setCategory(event.target.value)} />
      </div>
      <Input accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" />
      <div><Button disabled={busy || !file || !shortcode.trim() || !name.trim()} onClick={upload} type="button">上传</Button></div>
      {message ? <p className="text-sm text-muted" role="status">{message}</p> : null}
    </section>
    <section className="grid gap-3">
      {emojis.map((emoji) => <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3" key={emoji.shortcode}>
        <Image alt={emoji.name} className="h-8 w-8" height={32} src={emoji.imageUrl} unoptimized width={32} />
        <span className="min-w-0 flex-1">:{emoji.shortcode}: · {emoji.name} · {emoji.category}</span>
        <Button onClick={() => void toggle(emoji)} size="sm" type="button" variant="outline">{emoji.status === "active" ? "退休" : "恢复"}</Button>
      </div>)}
    </section>
  </div>;
}
