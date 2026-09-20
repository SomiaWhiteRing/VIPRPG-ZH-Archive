import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import type { WorkSourceLink } from "@/lib/work-sources";

export function WorkSourcesEditor({ values, onChange, disabled }: {
  values: WorkSourceLink[];
  onChange: (values: WorkSourceLink[]) => void;
  disabled?: boolean;
}) {
  return <fieldset disabled={disabled} className="grid gap-2">
    <legend className="mb-2 text-sm font-semibold">作品来源</legend>
    {values.map((value, index) => <div key={index} className="flex flex-wrap gap-2">
      <Input aria-label={`来源 ${index + 1} 名称`} className="w-32" value={value.label}
        onChange={(event) => onChange(values.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} />
      <Input aria-label={`来源 ${index + 1} 网址`} className="min-w-48 flex-1" type="url" required value={value.url}
        onChange={(event) => onChange(values.map((item, i) => i === index ? { ...item, url: event.target.value } : item))} />
      <Button type="button" variant="ghost" onClick={() => onChange(values.filter((_, i) => i !== index))}>删除</Button>
    </div>)}
    <Button className="w-fit" type="button" variant="outline" onClick={() => onChange([...values, { label: "来源链接", url: "" }])}>添加来源</Button>
  </fieldset>;
}
