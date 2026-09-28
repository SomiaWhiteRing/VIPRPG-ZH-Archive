import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { ImageOff, LoaderCircle, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/app/components/ui/button";
import { SortableListItem } from "@/app/components/ui/sortable-list-item";
import { useToast } from "@/app/components/ui/toast";
import { MAX_IMAGE_BYTES } from "@/lib/image-format";

type Item = File | string;
const fileIds = new WeakMap<File, string>();
function itemId(item: Item): string {
  if (typeof item === "string") return item;
  let id = fileIds.get(item);
  if (!id) { id = crypto.randomUUID(); fileIds.set(item, id); }
  return id;
}

export function PreviewPicker({ disabled = false, files, order, existingHashes, imageBaseUrl, onChange }: {
  disabled?: boolean;
  files: File[];
  order?: (string | number)[];
  existingHashes: string[];
  imageBaseUrl: string;
  onChange: (files: File[], order: (string | number)[]) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const items: Item[] = order ? order.map((entry) => typeof entry === "number" ? files[entry] : entry) : [...existingHashes, ...files];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  function change(next: Item[]) {
    const nextFiles: File[] = [];
    const nextOrder = next.map((item) => {
      if (typeof item === "string") return item;
      nextFiles.push(item);
      return nextFiles.length - 1;
    });
    onChange(nextFiles, nextOrder);
  }
  function move(from: number, to: number) {
    if (!disabled && from !== to && from >= 0 && to >= 0 && to < items.length) change(arrayMove(items, from, to));
  }
  return <div className="grid gap-3">
    <input id={id} ref={input} aria-label="上传预览图" type="file" accept="image/*" multiple className="sr-only" disabled={disabled} onChange={(event) => {
      const selected = Array.from(event.target.files ?? []);
      event.target.value = "";
      const invalid = selected.find((file) => !file.type.startsWith("image/") || !file.size || file.size > MAX_IMAGE_BYTES);
      if (invalid) { toast.error(`${invalid.name} 必须是非空图片，且不能超过 20 MiB。`); return; }
      const next = [...items];
      for (const file of selected) {
        if (!next.some((item) => typeof item !== "string" && item.name === file.name && item.size === file.size && item.lastModified === file.lastModified && item.type === file.type)) next.push(file);
      }
      if (selected.length) change(next);
    }} />
      <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
        if (over) move(items.findIndex((item) => itemId(item) === active.id), items.findIndex((item) => itemId(item) === over.id));
      }}>
        <SortableContext items={items.map(itemId)} strategy={rectSortingStrategy}>
          <ol className="flex flex-wrap gap-2" aria-label="预览图顺序">
            {items.map((item, index) => <SortableListItem key={itemId(item)} id={itemId(item)} disabled={disabled} className="relative size-28 shrink-0 rounded-md border border-border bg-card sm:size-36">
              {(handle) => <>
                <Button type="button" variant="ghost" disabled={disabled} ref={handle.setActivatorNodeRef} {...handle.attributes} {...handle.listeners}
                  aria-label={`拖动预览图 ${index + 1} 调整顺序`} className="size-full touch-none cursor-grab overflow-hidden p-0 active:cursor-grabbing">
                  <PreviewImage item={item} imageBaseUrl={imageBaseUrl} index={index} />
                </Button>
                <Button type="button" variant="ghost" disabled={disabled} aria-label={`移除预览图 ${index + 1}`}
                  className="absolute right-0 top-0 size-8 min-h-0 rounded-bl-md rounded-tr-md bg-black/50 p-0 text-white hover:bg-black/70"
                  onClick={() => change(items.filter((_, position) => position !== index))}><X aria-hidden /></Button>
              </>}
            </SortableListItem>)}
            <li className="size-28 shrink-0 sm:size-36">
              <Button type="button" variant="outline" disabled={disabled} aria-label="上传预览图" onClick={() => input.current?.click()}
                className="size-full border-dashed bg-background p-0 text-muted [&_svg]:size-7"><Plus aria-hidden /></Button>
            </li>
          </ol>
        </SortableContext>
      </DndContext>
  </div>;
}

function PreviewImage({ item, imageBaseUrl, index }: { item: Item; imageBaseUrl: string; index: number }) {
  const [local, setLocal] = useState<{ file: File; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (typeof item === "string") return;
    const url = URL.createObjectURL(item);
    setLocal({ file: item, url });
    return () => URL.revokeObjectURL(url);
  }, [item]);
  const src = typeof item === "string" ? imageBaseUrl + item : local?.file === item ? local.url : null;
  const label = typeof item === "string" ? `已有预览图 ${index + 1}` : item.name;
  return <span className="flex size-full items-center justify-center bg-background">
    {src && failed !== src ? <img src={src} alt={label} draggable={false} className="h-full w-full select-none object-contain" onError={() => setFailed(src)} /> :
      <span role="status" aria-label={src ? "图片加载失败" : "正在加载图片"}>
        {src ? <ImageOff aria-hidden /> : <LoaderCircle aria-hidden className="animate-spin" />}
      </span>}
  </span>;
}
