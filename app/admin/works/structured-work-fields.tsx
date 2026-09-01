"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { CharacterPicker } from "@/app/upload/character-picker";
import type {
  CharacterCreditSelection,
  CharacterSuggestion,
} from "@/lib/character-names";
import type { GameExternalLink } from "@/lib/server/db/game-library";

export function StructuredWorkFields(props: {
  tags: string[];
  characters: CharacterCreditSelection[];
  characterSuggestions: CharacterSuggestion[];
  previewBlobSha256s: string[];
  externalLinks: GameExternalLink[];
}) {
  const [characters, setCharacters] = useState(props.characters);
  return <div className="grid gap-5">
    <div className="grid gap-5 md:grid-cols-2">
      <TextList label="标签" name="tags" initialValues={props.tags} placeholder="标签名称" />
      <fieldset className="grid gap-2 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-semibold">登场角色</legend>
        <CharacterPicker
          id="admin-work-characters"
          name="characters"
          onChange={setCharacters}
          suggestions={props.characterSuggestions}
          values={characters}
        />
      </fieldset>
    </div>
    <PreviewList initialValues={props.previewBlobSha256s} />
    <ExternalLinkList initialValues={props.externalLinks} />
  </div>;
}

function TextList(props: { label: string; name: string; initialValues: string[]; placeholder: string }) {
  const [values, setValues] = useState(props.initialValues.length ? props.initialValues : [""]);
  return <fieldset className="grid gap-2 rounded-md border border-border p-3">
    <legend className="px-1 text-sm font-semibold">{props.label}</legend>
    <Textarea className="hidden" name={props.name} readOnly value={values.filter(Boolean).join("\n")} />
    {values.map((value, index) => <div className="flex items-center gap-2" key={index}>
      <Input placeholder={props.placeholder} value={value} onChange={(event) => setValues((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />
      <Button aria-label={"删除" + props.label + " " + (index + 1)} onClick={() => setValues((current) => current.filter((_, itemIndex) => itemIndex !== index))} size="sm" type="button" variant="ghost">删除</Button>
    </div>)}
    <Button className="w-fit" onClick={() => setValues((current) => [...current, ""])} size="sm" type="button" variant="outline">添加{props.label}</Button>
  </fieldset>;
}

function PreviewList({ initialValues }: { initialValues: string[] }) {
  const [values, setValues] = useState(initialValues.length ? initialValues : [""]);
  function move(index: number, direction: -1 | 1) {
    setValues((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const value = next[index];
      next[index] = next[target];
      next[target] = value;
      return next;
    });
  }
  return <fieldset className="grid gap-2 rounded-md border border-border p-3">
    <legend className="px-1 text-sm font-semibold">浏览图</legend>
    <p className="m-0 text-xs text-muted">第一项是主浏览图；只接受已上传对象的 SHA-256。</p>
    <Textarea className="hidden" name="preview_blob_sha256s" readOnly value={values.filter(Boolean).join("\n")} />
    {values.map((value, index) => <div className="flex flex-wrap items-center gap-2" key={index}>
      <span className="w-5 font-mono text-xs text-muted">{index + 1}</span>
      <Input className="min-w-60 flex-1 font-mono text-xs" aria-invalid={Boolean(value && !/^[a-f0-9]{64}$/i.test(value))} value={value} onChange={(event) => setValues((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />
      <Button disabled={index === 0} onClick={() => move(index, -1)} size="sm" type="button" variant="ghost">上移</Button>
      <Button disabled={index === values.length - 1} onClick={() => move(index, 1)} size="sm" type="button" variant="ghost">下移</Button>
      <Button onClick={() => setValues((current) => current.filter((_, itemIndex) => itemIndex !== index))} size="sm" type="button" variant="ghost">删除</Button>
    </div>)}
    <Button className="w-fit" onClick={() => setValues((current) => [...current, ""])} size="sm" type="button" variant="outline">添加浏览图</Button>
  </fieldset>;
}

function ExternalLinkList({ initialValues }: { initialValues: GameExternalLink[] }) {
  const empty = { id: 0, label: "", url: "", linkType: "other" };
  const [values, setValues] = useState(initialValues.length ? initialValues : [empty]);
  const serialized = values.filter((item) => item.label || item.url).map((item) => [item.label, item.url, item.linkType].map(escapePart).join("|")).join("\n");
  function update(index: number, value: Partial<GameExternalLink>) {
    setValues((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...value } : item));
  }
  return <fieldset className="grid gap-3 rounded-md border border-border p-3">
    <legend className="px-1 text-sm font-semibold">外部链接</legend>
    <Textarea className="hidden" name="external_links" readOnly value={serialized} />
    {values.map((link, index) => <div className="grid gap-2 border-b border-border pb-3 last:border-0 last:pb-0 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)_160px_auto]" key={index}>
      <Input aria-label={"链接 " + (index + 1) + " 名称"} placeholder="名称" value={link.label} onChange={(event) => update(index, { label: event.target.value })} />
      <Input aria-label={"链接 " + (index + 1) + " 网址"} placeholder="https://" type="url" value={link.url} onChange={(event) => update(index, { url: event.target.value })} />
      <SelectField aria-label={"链接 " + (index + 1) + " 类型"} value={link.linkType} onValueChange={(value) => update(index, { linkType: value })} options={[{ value: "official", label: "官方网站" }, { value: "wiki", label: "Wiki" }, { value: "source", label: "来源" }, { value: "video", label: "视频" }, { value: "download_page", label: "下载页" }, { value: "other", label: "其他" }]} />
      <Button onClick={() => setValues((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button" variant="ghost">删除</Button>
    </div>)}
    <Button className="w-fit" onClick={() => setValues((current) => [...current, { ...empty, id: current.length }])} size="sm" type="button" variant="outline">添加链接</Button>
  </fieldset>;
}

function escapePart(value: string): string { return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|"); }
