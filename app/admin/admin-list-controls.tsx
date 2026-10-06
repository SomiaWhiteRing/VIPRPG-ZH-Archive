import { Button, buttonVariants } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Search } from "lucide-react";

type Option = { value: string; label: string };

export function AdminListControls(props: {
  action: string;
  query?: string;
  searchLabel?: string;
  searchPlaceholder?: string;
  status?: string;
  statusLabel?: string;
  sort?: string;
  statusOptions?: Option[];
  sortOptions?: Option[];
  total: number;
  noun: string;
  pageSize?: number;
  children?: ReactNode;
  filtered?: boolean;
}) {
  const filtered = Boolean(
    props.filtered ||
      props.query ||
      (props.status && props.status !== "all") ||
      (props.sort && props.sort !== "default"),
  );
  return (
    <>
      <form
        key={JSON.stringify([props.action, props.query, props.status, props.sort])}
        action={props.action}
        className="admin-filters"
        aria-label={props.noun + "筛选"}
        method="get"
      >
        <div className="admin-filter-row">
          {props.query !== undefined ? (
            <Label className="admin-field admin-field-search">
              {props.searchLabel ?? "搜索"}
              <span className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input
                  className="pl-9"
                  defaultValue={props.query}
                  name="q"
                  placeholder={props.searchPlaceholder ?? "搜索" + props.noun}
                  type="search"
                />
              </span>
            </Label>
          ) : null}
          {props.statusOptions ? (
            <Label className="admin-field">
              {props.statusLabel ?? "状态"}
              <SelectField
                aria-label={props.statusLabel ?? "状态"}
                defaultValue={props.status ?? "all"}
                name="status"
                options={props.statusOptions}
              />
            </Label>
          ) : null}
          {props.sortOptions ? (
            <Label className="admin-field">
              排序
              <SelectField
                aria-label="排序"
                defaultValue={props.sort ?? "default"}
                name="sort"
                options={props.sortOptions}
              />
            </Label>
          ) : null}
          <div className="admin-filter-actions">
            <Button type="submit">应用筛选</Button>
            {filtered ? (
              <Link className={buttonVariants({ variant: "ghost" })} to={props.action}>
                清除
              </Link>
            ) : null}
          </div>
        </div>
        {props.children}
      </form>
      <AdminListMeta total={props.total} noun={props.noun} pageSize={props.pageSize} />
    </>
  );
}

export function AdminListMeta({ total, noun, pageSize }: { total: number; noun: string; pageSize?: number }) {
  return (
    <div className="admin-list-meta" aria-live="polite">
      <span>
        共 <strong className="font-semibold text-foreground tabular-nums">{total.toLocaleString("zh-CN")}</strong> 个{noun}
      </span>
      {pageSize ? <span>每页 {pageSize} 个</span> : null}
    </div>
  );
}

export function StickySaveBar({ children }: { children: ReactNode }) {
  return <div className="admin-save-bar">{children}</div>;
}

export function parseAdminPage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number.parseInt(raw ?? "1", 10);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function searchParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}
