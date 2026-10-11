import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/app/components/ui/radio-group";
import { constrainWorkVisibility, hasNonViprpgTag, WORK_AUDIENCE_OPTIONS, type WorkAudience, type WorkVisibility } from "@/lib/work-visibility";

export function WorkVisibilityField({ value, tags, disabled, onChange }: {
  value: WorkVisibility;
  tags: readonly string[];
  disabled: boolean;
  onChange: (value: WorkVisibility) => void;
}) {
  const homeDisabled = hasNonViprpgTag(tags) || value.audience === "maintainers";
  return <div className="grid gap-2">
    <span className="text-sm font-bold" id="upload-visibility-label">可见性</span>
    <RadioGroup
      aria-labelledby="upload-visibility-label"
      disabled={disabled}
      value={value.audience}
      onValueChange={(audience) => onChange(constrainWorkVisibility({ ...value, audience: audience as WorkAudience }, tags))}
    >
      {WORK_AUDIENCE_OPTIONS.map((option) => (
        <Label className="flex items-center gap-2" key={option.value}>
          <RadioGroupItem value={option.value} />
          {option.label}
        </Label>
      ))}
    </RadioGroup>
    <div className="flex min-h-10 items-center gap-2">
      <Checkbox id="upload-show-on-home" disabled={disabled || homeDisabled}
        checked={value.showOnHome && !homeDisabled}
        onCheckedChange={(checked) => onChange({ ...value, showOnHome: checked === true })} />
      <Label htmlFor="upload-show-on-home" className="font-normal">推送到首页</Label>
    </div>
  </div>;
}
