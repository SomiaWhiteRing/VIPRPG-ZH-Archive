import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale } from "@/lib/i18n/react";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";


import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { Notice } from "@/app/components/ui/notice";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import { useToast } from "@/app/components/ui/toast";
import type { CatalogSummary } from "@/lib/dto/db/catalogs";
import { useId, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

export function CatalogCreateFields({
  busy,
  onBusyChange,
  onCancel,
  workId,
}: {
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  workId?: number;
}) {
  const t = useMessages();
  const locale = useNavigationLocale();
  const navigate = useNavigate();
  const toast = useToast();
  const id = useId();
  const submitting = useRef(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [createdCatalog, setCreatedCatalog] = useState<CatalogSummary | null>(null);
  const [addUnconfirmed, setAddUnconfirmed] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || submitting.current || !title.trim()) return;
    submitting.current = true;
    onBusyChange(true);
    setAddUnconfirmed(false);
    let catalog = createdCatalog;
    try {
      if (!catalog) {
        const body = await requestJson<{ ok?: boolean; catalog?: CatalogSummary }>("/api/catalogs", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, description: description || null }),
        }, t("catalog.createFailed"));
        if (!body.catalog) throw new Error(t("catalog.createdMissing"));
        catalog = body.catalog;
        setCreatedCatalog(catalog);
      }
      if (workId !== undefined) {

        await requestJson(`/api/catalogs/${catalog.id}/items`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workId }),
        });

      }
      toast.success(workId === undefined ? t("catalog.created") : t("catalog.createdWithGame"));
      navigate({ pathname: `/catalogs/${catalog.id}`, search: locale ? new URLSearchParams({ [UI_LOCALE_PARAM]: locale }).toString() : "" });
    } catch (error) {
      if (catalog && workId !== undefined) {
        setAddUnconfirmed(true);
      } else {
        toast.error(error instanceof ApiResponseError ? error : t("relation.edit.network"));
      }
    } finally {
      submitting.current = false;
      onBusyChange(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <FormField controlId={`${id}-title`} label={t("library.title")}>
        <Input
          id={`${id}-title`}
          required
          disabled={busy || !!createdCatalog}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </FormField>
      <FormField controlId={`${id}-description`} label={t("forum.action.explain")}>
        <Textarea
          id={`${id}-description`}
          rows={3}
          disabled={busy || !!createdCatalog}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FormField>
      {addUnconfirmed ? <Notice>{t("catalog.retryAdd")}</Notice> : null}
      <div className="flex justify-end gap-2">
        <Button disabled={busy} onClick={onCancel} type="button" variant="outline">
          {t("relation.edit.cancel")}
        </Button>
        <Button disabled={busy || !title.trim()} type="submit">
          {busy
            ? workId === undefined ? t("catalog.creating") : t("catalog.creatingAndAdding")
            : workId === undefined ? t("catalog.create") : t("catalog.createAndAdd")}
        </Button>
      </div>
    </form>
  );
}
