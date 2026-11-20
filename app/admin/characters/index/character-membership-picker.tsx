import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { EmptyState } from "@/app/components/ui/empty-state";
import {
  characterMembershipNames,
  characterNameOptions,
  type CharacterIndexEntry,
  type CharacterNameSelection,
} from "@/lib/character-index";
import { characterNameKey, formatCharacterNamePair } from "@/lib/character-names";
import { useMessages } from "@/lib/i18n/react";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import {
  Autocomplete,
  TextField,
  Input as AriaInput,
  ListBox,
  ListBoxItem,
} from "react-aria-components";

export function CharacterNameFields({
  character,
  selected,
  onChange,
  disabled,
}: {
  character: CharacterIndexEntry;
  selected: Pick<CharacterNameSelection, "displayName" | "originalName">;
  onChange: (
    patch: Partial<
      Pick<CharacterNameSelection, "displayName" | "originalName">
    >,
  ) => void;
  disabled: boolean;
}) {
  const t = useMessages();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(
        [
          { language: "zh", field: "displayName", label: t("admin.characterMembers.zhName") },
          { language: "ja", field: "originalName", label: t("admin.characterMembers.jaName") },
        ] as const
      ).map(({ language, field, label }) => {
        const options = [
          ...new Set([
            ...characterNameOptions(character, language),
            selected[field],
          ]),
        ].map((name) => ({ value: name, label: name }));
        return (
          <div key={field}>
            <Label>{label}</Label>
            <SelectField
              aria-label={label}
              disabled={disabled}
              value={selected[field]}
              options={options}
              onValueChange={(value) => {
                if (value) onChange({ [field]: value });
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
export function CharacterMembershipPicker({
  characters,
  selected,
  onChange,
  disabled,
  excludeIds,
}: {
  characters: CharacterIndexEntry[];
  selected: CharacterNameSelection[];
  onChange: (values: CharacterNameSelection[]) => void;
  disabled: boolean;
  excludeIds: number[];
}) {
  const t = useMessages();
  const [query, setQuery] = useState("");
  const results = characters.filter(
    (character) =>
      !excludeIds.includes(character.id) &&
      !selected.some((item) => item.characterId === character.id) &&
      characterNameKey(
        [
          character.primaryName,
          character.originalName,
          ...character.aliases.map((alias) => alias.name),
        ].join(" "),
      ).includes(characterNameKey(query)),
  );
  return (
    <div className="grid gap-3">
      {selected.map((selection) => {
        const character = characters.find(
          (item) => item.id === selection.characterId,
        )!;
        return (
          <div
            key={selection.characterId}
            className="grid gap-2 border-b border-border pb-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {formatCharacterNamePair(selection.displayName, selection.originalName)}
              </span>
              <Button
                aria-label={t("admin.characterMembers.deselect", { name: selection.displayName })}
                type="button"
                size="icon"
                variant="ghost"
                disabled={disabled}
                onClick={() =>
                  onChange(
                    selected.filter(
                      (item) => item.characterId !== selection.characterId,
                    ),
                  )
                }
              >
                <X aria-hidden size={14} />
              </Button>
            </div>
            <CharacterNameFields
              character={character}
              selected={selection}
              disabled={disabled}
              onChange={(patch) =>
                onChange(
                  selected.map((item) =>
                    item.characterId === selection.characterId
                      ? { ...item, ...patch }
                      : item,
                  ),
                )
              }
            />
          </div>
        );
      })}
      <Autocomplete
        inputValue={query}
        onInputChange={setQuery}
        disableAutoFocusFirst
      >
        <TextField aria-label={t("admin.characterMembers.searchMember")} isDisabled={disabled}>
          <AriaInput
            placeholder={t("admin.characterMembers.searchHint")}
            render={(props) => <Input {...props} />}
          />
        </TextField>
        <ListBox
          items={results.slice(0, 40)}
          aria-label={t("admin.characterMembers.options")}
          selectionMode="none"
          disabledKeys={
            disabled || selected.length >= 100
              ? results.map((item) => item.id)
              : []
          }
          onAction={(key) => {
            const character = results.find((item) => item.id === key);
            if (!disabled && selected.length < 100 && character)
              onChange([...selected, characterMembershipNames(character)]);
          }}
          renderEmptyState={() => (
            <EmptyState
              title={t("admin.characterMembers.empty")}
              variant="plain"
              className="p-3 text-xs"
            />
          )}
          className="max-h-48 overflow-y-auto rounded-md border border-border outline-none"
        >
          {(character) => (
            <ListBoxItem
              id={character.id}
              textValue={character.primaryName}
              className="flex min-h-10 cursor-pointer items-center gap-2 border-b border-border/50 px-3 py-2 text-sm outline-none last:border-b-0 data-focused:bg-primary/10 data-focused:text-primary data-disabled:cursor-not-allowed data-disabled:opacity-50"
            >
              <Plus aria-hidden size={13} />
              <span>{character.primaryName}</span>
              <span className="truncate text-xs text-muted">
                {character.originalName}
              </span>
            </ListBoxItem>
          )}
        </ListBox>
      </Autocomplete>
      {results.length > 40 ? (
        <p className="text-xs text-muted">
          {t("admin.characterMembers.remaining", { count: results.length - 40 })}
        </p>
      ) : null}
    </div>
  );
}
