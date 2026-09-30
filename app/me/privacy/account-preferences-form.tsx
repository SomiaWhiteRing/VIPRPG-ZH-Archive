import { useId, useState } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Checkbox } from "react-aria-components";
import { Button } from "@/app/components/ui/button";
import { SortableListItem, SortableOverlay } from "@/app/components/ui/sortable-list-item";
import { Check, GripVertical } from "lucide-react";
import { ACCOUNT_SHORTCUTS, type AccountPreferences } from "@/lib/account-preferences";
import { CheckboxField } from "@/app/components/ui/checkbox-field";
import { RedirectForm } from "@/app/components/ui/redirect-form";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";

export function AccountPreferencesForm({ preferences }: { preferences: AccountPreferences }) {
  const [order, setOrder] = useState(() => [
    ...preferences.shortcuts,
    ...ACCOUNT_SHORTCUTS.map((item) => item.href).filter((href) => !preferences.shortcuts.includes(href)),
  ]);
  const [selected, setSelected] = useState(new Set(preferences.shortcuts));
  const dndId = useId();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeItem = ACCOUNT_SHORTCUTS.find((item) => item.href === activeKey);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const rowClassName = (checked: boolean) => `flex min-h-11 items-center gap-3 rounded px-2 py-1 ${checked ? "bg-primary/10" : ""}`;

  return (
    <RedirectForm action="/api/account/privacy" method="post" className="mt-6">
      <input name="section" type="hidden" value="preferences" />
      <input name="shortcuts" type="hidden" value={JSON.stringify(order.filter((href) => selected.has(href)))} />
      <h2 className="mb-3 text-lg font-semibold">偏好</h2>
      <div className="mb-3">
        <CheckboxField name="notifyUploadedWorkComments" label="接收上传的作品的评论提醒" defaultChecked={preferences.notifyUploadedWorkComments} />
      </div>
      <CheckboxField name="includePlayerInZip" label="下载ZIP时附带EasyRPG Player（若有）" defaultChecked={preferences.includePlayerInZip} />
      <div className="mt-3">
        <input name="showGameCardInteractionData" type="hidden" value="0" />
        <CheckboxField name="showGameCardInteractionData" label="在游戏卡片展示互动数据" defaultChecked={preferences.showGameCardInteractionData} />
      </div>
      <h3 className="mb-2 mt-5 text-sm font-semibold" id="shortcut-heading">头像菜单显示的快捷入口</h3>
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{
          screenReaderInstructions: { draggable: "按 Enter 开始排序，用方向键移动，按 Enter 确认，按 Escape 取消。" },
          announcements: {
            onDragStart: ({ active }) => `开始排序：${ACCOUNT_SHORTCUTS.find((item) => item.href === active.id)?.label}。`,
            onDragOver: ({ over }) => over ? `移动到第 ${order.indexOf(String(over.id)) + 1} 项。` : "已离开排序区域。",
            onDragEnd: ({ over }) => over ? `排序完成，位于第 ${order.indexOf(String(over.id)) + 1} 项。` : "排序取消。",
            onDragCancel: () => "排序取消。",
          },
        }}
        onDragStart={({ active }) => setActiveKey(String(active.id))}
        onDragCancel={() => setActiveKey(null)}
        onDragEnd={({ active, over }) => {
          setActiveKey(null);
          if (!over || active.id === over.id) return;
          setOrder((current) => {
            const from = current.indexOf(String(active.id));
            const to = current.indexOf(String(over.id));
            return from < 0 || to < 0 ? current : arrayMove(current, from, to);
          });
        }}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ul aria-labelledby="shortcut-heading" aria-describedby="shortcut-help" className="grid gap-1 rounded-md border border-border p-2">
            {order.map((href) => {
              const item = ACCOUNT_SHORTCUTS.find((shortcut) => shortcut.href === href)!;
              return (
                <SortableListItem key={href} id={href} className={rowClassName(selected.has(href))}>
                  {({ attributes, listeners, setActivatorNodeRef }) => <>
                    <Button
                      {...attributes}
                      {...listeners}
                      ref={setActivatorNodeRef}
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`排序：${item.label}`}
                      className="size-9 touch-none select-none cursor-grab text-muted active:cursor-grabbing"
                      onContextMenu={(event) => event.preventDefault()}
                    >
                      <GripVertical aria-hidden size={18} />
                    </Button>
                    <Checkbox isSelected={selected.has(href)} onChange={(checked) => setSelected((current) => {
                      const next = new Set(current);
                      if (checked) next.add(href);
                      else next.delete(href);
                      return next;
                    })} aria-label={`显示${item.label}`} className="flex min-h-9 cursor-pointer items-center gap-2">
                      {({ isSelected }) => <><span className="grid size-4 place-items-center rounded-sm border border-border">{isSelected && <Check aria-hidden size={14} />}</span><span>{item.label}</span></>}
                    </Checkbox>
                  </>}
                </SortableListItem>
              );
            })}
          </ul>
        </SortableContext>
        <SortableOverlay>
          {activeItem && <div aria-hidden inert className="rounded bg-card text-foreground shadow-lg ring-1 ring-primary/20">
            <div className={rowClassName(selected.has(activeItem.href))}>
              <span className="grid size-9 shrink-0 place-items-center text-muted"><GripVertical size={16} /></span>
              <span className="flex min-h-9 items-center gap-2">
                <span className="grid size-4 place-items-center rounded-sm border border-border">{selected.has(activeItem.href) && <Check size={14} />}</span>
                <span>{activeItem.label}</span>
              </span>
            </div>
          </div>}
        </SortableOverlay>
      </DndContext>
      <div className="mt-5"><Rm2kButton type="submit">保存偏好设置</Rm2kButton></div>
    </RedirectForm>
  );
}
