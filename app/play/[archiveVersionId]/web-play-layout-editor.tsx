import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useState } from "react";
import { controlDefinitions, controlIds } from "./web-play-controls-preferences";
import type { ControlId, ControlLayout, ControlPlacement, DisplayOrientation } from "./web-play-controls-preferences";

type Props = {
  orientation: DisplayOrientation;
  layout: ControlLayout;
  selected: ControlId;
  dragging: boolean;
  onSelect: (id: ControlId) => void;
  onChange: (id: ControlId, change: Partial<ControlPlacement>) => void;
  onReset: () => void;
  onCancel: () => void;
  onSave: () => void;
};

const buttonClass = "border-white/40 bg-zinc-900 text-white hover:border-white hover:bg-zinc-700 hover:text-white";

export function WebPlayLayoutEditor({ orientation, layout, selected, dragging, onSelect, onChange, onReset, onCancel, onSave }: Props) {
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const control = layout.buttons[selected];
  const definition = controlDefinitions[selected];
  return (
    <div className={dragging ? "pointer-events-none invisible absolute inset-0 z-40" : "pointer-events-none absolute inset-0 z-40"}>
      <div className="pointer-events-auto absolute right-0 top-0 flex gap-1">
        <Button aria-expanded={propertiesOpen} aria-controls="web-play-layout-properties" className={buttonClass} onClick={() => setPropertiesOpen(!propertiesOpen)} size="sm" type="button" variant="outline">属性</Button>
        <Button className={buttonClass} onClick={onReset} size="sm" type="button" variant="outline">恢复默认</Button>
        <Button className={buttonClass} onClick={onCancel} size="sm" type="button" variant="outline">取消</Button>
        <Button className={buttonClass} onClick={onSave} size="sm" type="button" variant="outline">保存</Button>
      </div>
      <div className={propertiesOpen ? "pointer-events-auto absolute right-0 top-12 max-h-[calc(100%-3rem)] w-[min(20rem,100%)] overflow-y-auto overscroll-contain rounded-lg border border-white/25 bg-zinc-950 p-3 text-white" : "hidden"} id="web-play-layout-properties">
        <p className="m-0 mb-3 text-xs leading-relaxed" id="web-play-layout-help">
          拖动按钮可自由移动；{orientation === "portrait" ? "画面只可上下移动。" : "横屏画面位置固定。"}收起属性可调整被面板遮挡的位置。
        </p>
        <div aria-label="选择或添加按钮" className="mb-3 flex flex-wrap gap-1.5" role="group">
          {controlIds.map((id) => {
            const visible = layout.buttons[id].visible;
            const { label } = controlDefinitions[id];
            return (
              <Button
                aria-label={visible ? `选择${label}` : `添加${label}`}
                aria-pressed={selected === id && visible}
                className={`${buttonClass} aria-pressed:border-white aria-pressed:bg-zinc-600`}
                key={id}
                onClick={() => { if (!visible) onChange(id, { visible: true }); onSelect(id); }}
                size="sm"
                type="button"
                variant="outline"
              >{visible ? label : `＋ ${label}`}</Button>
            );
          })}
        </div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{definition.label}</span>
          {definition.optional && control.visible ? (
            <Button aria-label={`删除${definition.label}`} className={buttonClass} onClick={() => { onChange(selected, { visible: false }); onSelect("decision"); }} size="sm" type="button" variant="outline">删除</Button>
          ) : null}
        </div>
        <LayoutSlider label="大小" value={Math.round(control.size * 100)} min={50} max={200} onChange={(value) => onChange(selected, { size: value / 100 })} />
        <LayoutSlider label="透明度" value={Math.round((1 - control.opacity) * 100)} min={0} max={100} onChange={(value) => onChange(selected, { opacity: 1 - value / 100 })} />
      </div>
    </div>
  );
}

function LayoutSlider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className="mt-3">
      <div className="flex justify-between gap-2 text-xs"><span>{label}</span><span>{value}%</span></div>
      <Input aria-label={label} aria-valuetext={`${value}%`} className="h-9 cursor-pointer touch-none border-0 bg-transparent p-0 accent-white shadow-none" type="range" min={min} max={max} step={1} value={value} onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
    </div>
  );
}
