import type { CharacterNameInput } from "@/app/components/characters/character-create-dialog";
import { CharacterCreateDialog } from "@/app/components/characters/character-create-dialog";
import { Button } from "@/app/components/ui/button";
import type { ApiResponsePayload } from "@/lib/ui/api-response";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale } from "@/lib/i18n/react";
import { requestJson } from "@/lib/ui/api-response";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";

type CharacterCreateResponse = ApiResponsePayload & {
  character?: { id: number };
};

export function CharacterCreateButton({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const t = useMessages();
  const locale = useNavigationLocale();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function createCharacter(input: CharacterNameInput) {
    const payload = await requestJson<CharacterCreateResponse>(
      "/api/admin/characters",
      {
        body: JSON.stringify(input),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      },
      t("admin.characterList.createFailed"),
    );
    const characterId = payload.character?.id;
    if (!Number.isSafeInteger(characterId) || Number(characterId) <= 0) {
      throw new Error(
        t("admin.characterList.missingId"),
      );
    }
    const search = locale ? `?${new URLSearchParams({ [UI_LOCALE_PARAM]: locale })}` : "";
    navigate(`/admin/characters/${characterId}${search}`);
  }

  return (
    <>
      <Button
        disabled={disabled}
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        {t("admin.characterList.create")}
      </Button>
      <CharacterCreateDialog
        description={t("admin.characterList.createHint")}
        onCreate={createCharacter}
        onOpenChange={setOpen}
        open={open}
        returnFocus={() => triggerRef.current}
        submitLabel={t("admin.characterList.create")}
        submittingLabel={t("admin.characterList.creating")}
        title={t("admin.characterList.create")}
      />
    </>
  );
}
