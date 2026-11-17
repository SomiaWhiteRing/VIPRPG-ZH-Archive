import { RichMessage } from "@/app/components/ui/rich-message";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import type { ReactNode } from "react";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale } from "@/lib/i18n/react";
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
  const t = useMessages();
  const navigationLocale = useNavigationLocale();
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
        aria-label={t("admin.list.filters", { noun: props.noun })}
        method="get"
      >
        {navigationLocale ? <input type="hidden" name={UI_LOCALE_PARAM} value={navigationLocale} /> : null}
        <div className="admin-filter-row">
          {props.query !== undefined ? (
            <Label className="admin-field admin-field-search">
              {props.searchLabel ?? t("admin.list.search")}
              <span className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input
                  className="pl-9"
                  defaultValue={props.query}
                  name="q"
                  placeholder={props.searchPlaceholder ?? t("admin.list.searchNamed", { noun: props.noun })}
                  type="search"
                />
              </span>
            </Label>
          ) : null}
          {props.statusOptions ? (
            <Label className="admin-field">
              {props.statusLabel ?? t("admin.list.status")}
              <SelectField
                aria-label={props.statusLabel ?? t("admin.list.status")}
                defaultValue={props.status ?? "all"}
                name="status"
                options={props.statusOptions}
              />
            </Label>
          ) : null}
          {props.sortOptions ? (
            <Label className="admin-field">
              {t("admin.list.sort")}
              <SelectField
                aria-label={t("admin.list.sort")}
                defaultValue={props.sort ?? "default"}
                name="sort"
                options={props.sortOptions}
              />
            </Label>
          ) : null}
          <div className="admin-filter-actions">
            <Button type="submit">{t("admin.list.apply")}</Button>
            {filtered ? (
              <Link className={buttonVariants({ variant: "ghost" })} to={props.action}>
                {t("admin.list.clear")}
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
  const t = useMessages();
  return (
    <div className="admin-list-meta" aria-live="polite">
      <span><RichMessage id="admin.list.total" values={{ count: total, noun }} components={{ emphasis: children => <strong key="count" className="font-semibold text-foreground tabular-nums">{children}</strong> }} /></span>
      {pageSize ? <span>{t("admin.list.pageSize", { count: pageSize })}</span> : null}
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
