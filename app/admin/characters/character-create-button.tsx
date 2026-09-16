import type { CharacterNameInput } from "@/app/components/characters/character-create-dialog";
import { CharacterCreateDialog } from "@/app/components/characters/character-create-dialog";
import { Button } from "@/app/components/ui/button";
import type { ApiResponsePayload } from "@/lib/ui/api-response";
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
      "角色创建失败",
    );
    const characterId = payload.character?.id;
    if (!Number.isSafeInteger(characterId) || Number(characterId) <= 0) {
      throw new Error(
        "角色已创建，但服务器没有返回角色 ID。请刷新列表后查找该角色。",
      );
    }
    navigate(`/admin/characters/${characterId}`);
  }

  return (
    <>
      <Button
        disabled={disabled}
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        创建角色
      </Button>
      <CharacterCreateDialog
        description="若日语名已存在，将打开已有角色，不修改已有资料；否则创建新角色。"
        onCreate={createCharacter}
        onOpenChange={setOpen}
        open={open}
        returnFocus={() => triggerRef.current}
        submitLabel="创建角色"
        submittingLabel="创建中…"
        title="创建角色"
      />
    </>
  );
}
