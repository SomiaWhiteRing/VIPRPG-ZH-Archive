import { useState } from "react";
import { Button, Checkbox, DropIndicator, GridList, GridListItem, useDragAndDrop } from "react-aria-components";
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
  const { dragAndDropHooks } = useDragAndDrop({
    renderDropIndicator: (target) => <DropIndicator target={target} className="h-0.5 bg-transparent data-[drop-target]:bg-primary" />,
    getItems: (keys) => [...keys].map((key) => ({ "text/plain": String(key) })),
    onReorder(event) {
      if (event.keys.has(event.target.key)) return;
      setOrder((current) => {
        const moving = current.filter((href) => event.keys.has(href));
        const rest = current.filter((href) => !event.keys.has(href));
        const index = rest.indexOf(String(event.target.key));
        if (index < 0) return current;
        rest.splice(index + (event.target.dropPosition === "after" ? 1 : 0), 0, ...moving);
        return rest;
      });
    },
  });

  return (
    <RedirectForm action="/api/account/privacy" method="post" className="mt-6">
      <input name="section" type="hidden" value="preferences" />
      <input name="shortcuts" type="hidden" value={JSON.stringify(order.filter((href) => selected.has(href)))} />
      <h2 className="mb-3 text-lg font-semibold">偏好</h2>
      <CheckboxField name="includePlayerInZip" label="下载ZIP时附带EasyRPG Player（若有）" defaultChecked={preferences.includePlayerInZip} />
      <h3 className="mb-2 mt-5 text-sm font-semibold" id="shortcut-heading">头像菜单显示的快捷入口</h3>
      <p className="mb-3 text-sm text-muted" id="shortcut-help">勾选要显示的入口，拖动手柄排序；也可聚焦手柄后按 Enter，再用方向键移动并按 Enter 确认。个人中心始终显示，需上传权限的入口仅在有权限时显示。</p>
      <GridList
        aria-labelledby="shortcut-heading"
        aria-describedby="shortcut-help"
        className="grid gap-1 rounded-md border border-border p-2"
        // Keep GridList's drag/drop machinery active, but never let its selection
        // state turn checked shortcuts into a multi-item drag.
        selectionMode="multiple"
        selectedKeys={new Set()}
        onSelectionChange={() => undefined}
        dragAndDropHooks={dragAndDropHooks}
        items={order.map((href) => ACCOUNT_SHORTCUTS.find((item) => item.href === href)!)}
      >
        {(item) => (
          <GridListItem id={item.href} textValue={item.label} className={`flex min-h-11 items-center gap-3 rounded px-2 py-1 outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-primary data-[dragging]:opacity-50 ${selected.has(item.href) ? "bg-primary/10" : ""}`}>
            <Button slot="drag" type="button" aria-label={`排序：${item.label}`} className="!pointer-events-auto grid size-9 touch-none select-none cursor-grab place-items-center rounded text-muted outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-primary">
              <GripVertical aria-hidden size={18} />
            </Button>
            {/* Visibility is independent of GridList selection, which controls multi-item dragging. */}
            <Checkbox slot={null} isSelected={selected.has(item.href)} onChange={(checked) => setSelected((current) => {
              const next = new Set(current);
              if (checked) next.add(item.href);
              else next.delete(item.href);
              return next;
            })} aria-label={`显示${item.label}`} className="flex min-h-9 cursor-pointer items-center gap-2">
              {({ isSelected }) => <><span className="grid size-4 place-items-center rounded-sm border border-border">{isSelected && <Check aria-hidden size={14} />}</span><span>{item.label}</span></>}
            </Checkbox>
          </GridListItem>
        )}
      </GridList>
      <div className="mt-5"><Rm2kButton type="submit">保存偏好设置</Rm2kButton></div>
    </RedirectForm>
  );
}
