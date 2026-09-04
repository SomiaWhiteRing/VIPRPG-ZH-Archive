import Link from "next/link";
import type { ReactNode } from "react";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";

type Option = { value: string; label: string };

export function AdminListControls(props: {
  action: string;
  query: string;
  status?: string;
  sort?: string;
  statusOptions?: Option[];
  sortOptions?: Option[];
  total: number;
  noun: string;
}) {
  const filtered = Boolean(
    props.query ||
      (props.status && props.status !== "all") ||
      (props.sort && props.sort !== "default"),
  );
  return (
    <div className="flex flex-wrap items-end gap-2 border-b border-border pb-3" aria-label={props.noun + "工具栏"}>
      <form action={props.action} className="flex min-w-0 flex-1 flex-wrap items-end gap-2" method="get">
        <Label className="grid min-w-48 flex-1 gap-1 text-xs font-semibold text-muted">
          搜索
          <Input defaultValue={props.query} name="q" placeholder={"搜索" + props.noun} type="search" />
        </Label>
        {props.statusOptions ? (
          <Label className="grid min-w-36 gap-1 text-xs font-semibold text-muted">
            状态
            <SelectField aria-label="状态" defaultValue={props.status ?? "all"} name="status" options={props.statusOptions} />
          </Label>
        ) : null}
        {props.sortOptions ? (
          <Label className="grid min-w-36 gap-1 text-xs font-semibold text-muted">
            排序
            <SelectField aria-label="排序" defaultValue={props.sort ?? "default"} name="sort" options={props.sortOptions} />
          </Label>
        ) : null}
        <Button type="submit">应用</Button>
        {filtered ? <Link className={buttonVariants({ variant: "ghost" })} href={props.action}>清除</Link> : null}
      </form>
      <span className="pb-2 font-mono text-xs text-muted">共 {props.total.toLocaleString("zh-CN")} 个{props.noun}</span>
    </div>
  );
}

export function StickySaveBar({ children }: { children: ReactNode }) {
  return <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/95 p-3 shadow-[0_-8px_20px_rgb(23_33_43/8%)] backdrop-blur">{children}</div>;
}

export function parseAdminPage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number.parseInt(raw ?? "1", 10);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function searchParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}
