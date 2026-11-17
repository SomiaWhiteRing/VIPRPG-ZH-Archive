import { useEffect, useId, useLayoutEffect, useState } from "react";
import { ToggleGroup } from "radix-ui";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import { Button } from "@/app/components/ui/button";
import { SortableListItem, SortableOverlay } from "@/app/components/ui/sortable-list-item";
import { GripVertical, Plus, X } from "lucide-react";
import { ACCOUNT_SHORTCUTS, COLOR_THEME_OPTIONS, parseColorTheme, type AccountPreferences } from "@/lib/account-preferences";
import { CheckboxField } from "@/app/components/ui/checkbox-field";
import { useColorThemePreview } from "@/app/components/color-theme-preview";
import { useMessages } from "@/lib/i18n/react";
import { SelectField } from "@/app/components/ui/select";
import { UI_LOCALES } from "@/lib/i18n/locale";

export function AccountPreferencesFields({ preferences, onNotifyUploadedWorkCommentsChange }: {
  preferences: AccountPreferences;
  onNotifyUploadedWorkCommentsChange: (checked: boolean) => void;
}) {
  const [colorTheme, setColorTheme] = useState(preferences.colorTheme);
  const t = useMessages();
  const setThemePreview = useColorThemePreview();
  useLayoutEffect(() => {
    setThemePreview(colorTheme);
    return () => setThemePreview(null);
  }, [colorTheme, setThemePreview]);
  useEffect(() => {
    function restoreSavedTheme(event: PageTransitionEvent) {
      if (event.persisted) setColorTheme(preferences.colorTheme);
    }
    window.addEventListener("pageshow", restoreSavedTheme);
    return () => window.removeEventListener("pageshow", restoreSavedTheme);
  }, [preferences.colorTheme]);
  const [shortcuts, setShortcuts] = useState(preferences.shortcuts);
  const dndId = useId();
  const themeId = useId();
  const languageId = useId();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeItem = ACCOUNT_SHORTCUTS.find((item) => item.href === activeKey);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const shortcutClassName = "flex min-h-11 items-center rounded-full border border-primary bg-primary/10";

  return (
    <div className="mt-6">
      <input name="shortcuts" type="hidden" value={JSON.stringify(shortcuts)} />
      <h2 className="mb-3 text-lg font-semibold">{t("account.preferences.title")}</h2>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Label htmlFor={languageId}>{t("account.language.label")}</Label>
        <SelectField id={languageId} name="uiLanguage" className="w-44"
          defaultValue={preferences.uiLanguage}
          options={[{ value: "auto", label: t("account.language.auto") }, ...Object.entries(UI_LOCALES).map(([value, label]) => ({ value, label }))]} />
      </div>
      <input name="colorTheme" type="hidden" value={colorTheme} />
      <div className="mb-5 flex items-center gap-3">
        <span id={themeId} className="shrink-0 text-sm font-semibold">{t("account.preferences.theme")}</span>
        <ToggleGroup.Root
          type="single"
          orientation="horizontal"
          aria-labelledby={themeId}
          value={colorTheme}
          onValueChange={(value) => { if (value) setColorTheme(parseColorTheme(value)); }}
          className="inline-flex shrink-0 gap-1 rounded-full border border-border bg-muted/10 p-1"
        >
          {COLOR_THEME_OPTIONS.map((option) => (
            <ToggleGroup.Item key={option.value} value={option.value} asChild>
              <Button type="button" variant="ghost" size="sm" className="min-h-8 rounded-full px-3 text-xs font-medium data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm data-[state=on]:hover:bg-primary/90">
                {t(`account.theme.${option.value}`)}
              </Button>
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </div>
      <div className="mb-3">
        <Label className="flex min-h-10 cursor-pointer items-center gap-2">
          <Checkbox name="notifyUploadedWorkComments" value="1" checked={preferences.notifyUploadedWorkComments}
            onCheckedChange={checked => onNotifyUploadedWorkCommentsChange(checked === true)} />
          {t("account.preferences.workAlerts")}
        </Label>
      </div>
      <CheckboxField name="includePlayerInZip" label={t("account.preferences.includePlayer")} defaultChecked={preferences.includePlayerInZip} />
      <div className="mt-3">
        <input name="showGameCardInteractionData" type="hidden" value="0" />
        <CheckboxField name="showGameCardInteractionData" label={t("account.preferences.engagement")} defaultChecked={preferences.showGameCardInteractionData} />
      </div>
      <div className="mt-3">
        <input name="hideDeletedContent" type="hidden" value="0" />
        <CheckboxField name="hideDeletedContent" label={t("account.preferences.hideDeleted")} defaultChecked={preferences.hideDeletedContent} />
      </div>
      <h3 className="mb-2 mt-5 text-sm font-semibold" id="shortcut-heading">{t("account.shortcuts.heading")}</h3>
      <h4 className="mb-2 text-sm font-medium text-muted" id="shortcut-selected-heading">{t("account.shortcuts.selected")}</h4>
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{
          screenReaderInstructions: { draggable: t("account.shortcuts.instructions") },
          announcements: {
            onDragStart: ({ active }) => {
              const item = ACCOUNT_SHORTCUTS.find((entry) => entry.href === active.id);
              return item ? t("account.shortcuts.start", { label: t(item.label) }) : undefined;
            },
            onDragOver: ({ over }) => over ? t("account.shortcuts.move", { position: shortcuts.indexOf(String(over.id)) + 1 }) : t("account.shortcuts.leave"),
            onDragEnd: ({ over }) => over ? t("account.shortcuts.done", { position: shortcuts.indexOf(String(over.id)) + 1 }) : t("account.shortcuts.cancel"),
            onDragCancel: () => t("account.shortcuts.cancel"),
          },
        }}
        onDragStart={({ active }) => setActiveKey(String(active.id))}
        onDragCancel={() => setActiveKey(null)}
        onDragEnd={({ active, over }) => {
          setActiveKey(null);
          if (!over || active.id === over.id) return;
          setShortcuts((current) => {
            const from = current.indexOf(String(active.id));
            const to = current.indexOf(String(over.id));
            return from < 0 || to < 0 ? current : arrayMove(current, from, to);
          });
        }}
      >
        <SortableContext items={shortcuts} strategy={rectSortingStrategy}>
          <ul aria-labelledby="shortcut-selected-heading" className="flex min-h-11 flex-wrap gap-2">
            {shortcuts.length === 0 && <li className="flex min-h-11 items-center text-sm text-muted">{t("account.shortcuts.none")}</li>}
            {shortcuts.map((href) => {
              const item = ACCOUNT_SHORTCUTS.find((shortcut) => shortcut.href === href)!;
              return (
                <SortableListItem key={href} id={href} className={shortcutClassName}>
                  {({ attributes, listeners, setActivatorNodeRef }) => <>
                    <Button
                      {...attributes}
                      {...listeners}
                      ref={setActivatorNodeRef}
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("account.shortcuts.sort", { label: t(item.label) })}
                      className="size-11 touch-none select-none cursor-grab rounded-full text-muted active:cursor-grabbing"
                      onContextMenu={(event) => event.preventDefault()}
                    >
                      <GripVertical aria-hidden size={18} />
                    </Button>
                    <span className="whitespace-nowrap text-sm">{t(item.label)}</span>
                    <Button type="button" variant="ghost" size="icon" className="size-11 rounded-full text-muted"
                      aria-label={t("account.shortcuts.remove", { label: t(item.label) })} onClick={() => setShortcuts((current) => current.filter((entry) => entry !== href))}>
                      <X aria-hidden />
                    </Button>
                  </>}
                </SortableListItem>
              );
            })}
          </ul>
        </SortableContext>
        <SortableOverlay>
          {activeItem && <div aria-hidden inert className="rounded-full bg-card text-foreground shadow-lg">
            <div className={shortcutClassName}>
              <span className="grid size-11 shrink-0 place-items-center text-muted"><GripVertical size={16} /></span>
              <span className="whitespace-nowrap text-sm">{t(activeItem.label)}</span>
              <span className="grid size-11 shrink-0 place-items-center text-muted"><X size={16} /></span>
            </div>
          </div>}
        </SortableOverlay>
      </DndContext>
      {shortcuts.length < ACCOUNT_SHORTCUTS.length && <div className="mt-5 border-t border-border pt-4" role="group" aria-labelledby="shortcut-available-heading">
        <h4 className="mb-2 text-sm font-medium text-muted" id="shortcut-available-heading">{t("account.shortcuts.available")}</h4>
        <div className="flex flex-wrap gap-2">
          {ACCOUNT_SHORTCUTS.filter((item) => !shortcuts.includes(item.href)).map((item) => (
            <Button key={item.href} type="button" variant="outline" className="min-h-11 font-normal shadow-none"
              aria-label={t("account.shortcuts.add", { label: t(item.label) })} onClick={() => setShortcuts((current) => [...current, item.href])}>
              <Plus aria-hidden />{t(item.label)}
            </Button>
          ))}
        </div>
      </div>}
    </div>
  );
}
