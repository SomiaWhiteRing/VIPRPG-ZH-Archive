import { Input } from "@/app/components/ui/input";
import { TokenInput } from "@/app/components/ui/token-input";
import { cn } from "@/lib/ui/cn";
import { Check, ChevronDown, X } from "lucide-react";
import { useContext, useRef, useState, type ReactNode } from "react";
import {
  Button,
  ComboBox,
  ComboBoxStateContext,
  Input as AriaInput,
  ListBox,
  ListBoxItem,
  Popover,
  type Key,
} from "react-aria-components";

type SearchComboBoxProps<T> = {
  id: string;
  label: string;
  query: string;
  onQueryChange: (query: string) => void;
  items: T[];
  getKey: (item: T) => Key;
  getText: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onChoose: (item: T) => void;
  selectedKey?: Key | null;
  onClear?: () => void;
  disabled?: boolean;
  invalid?: boolean;
  descriptionId?: string;
  placeholder?: string;
  tokens?: ReactNode;
  preserveHoverRows?: boolean;
  inputSuffix?: ReactNode;
  loading?: boolean;
  emptyState?: ReactNode;
  footer?: ReactNode;
  onOpenChange?: (open: boolean) => void;
  onRemoveLast?: () => void;
  onCommit?: () => void;
  /** Token entry retains its existing type-and-Enter shortcut. */
  enterSelectsFirst?: boolean;
  isItemDisabled?: (item: T) => boolean;
  maxLength?: number;
  itemClassName?: string;
};

/** Search mechanics belong here; filtering, creation and domain edits stay with callers. */
export function SearchComboBox<T>(props: SearchComboBoxProps<T>) {
  const [value, setValue] = useState<Key | null>(null);
  return (
    <ComboBox
      aria-label={props.label}
      inputValue={props.query}
      value={props.selectedKey === undefined ? value : props.selectedKey}
      items={props.items}
      isDisabled={props.disabled}
      isInvalid={props.invalid}
      disabledKeys={props.items
        .filter((item) => props.isItemDisabled?.(item))
        .map(props.getKey)}
      menuTrigger="focus"
      allowsCustomValue
      allowsEmptyCollection={Boolean(
        props.items.length || props.emptyState || props.loading,
      )}
      onInputChange={(query) => {
        if (props.selectedKey === undefined) setValue(null);
        props.onQueryChange(query);
      }}
      onOpenChange={(open) => {
        if (open && props.selectedKey === undefined) setValue(null);
        props.onOpenChange?.(open);
      }}
      onChange={(key) => {
        const item = props.items.find((item) => props.getKey(item) === key);
        if (!item || props.isItemDisabled?.(item)) return;
        if (props.selectedKey === undefined) setValue(key);
        props.onChoose(item);
      }}
    >
      <SearchComboBoxBody {...props} />
    </ComboBox>
  );
}

function SearchComboBoxBody<T>(props: SearchComboBoxProps<T>) {
  const state = useContext(ComboBoxStateContext)!;
  const container = useRef<HTMLDivElement>(null);
  const showClear = Boolean(
    props.onClear && (props.query || props.selectedKey != null),
  );
  const field = (
    <AriaInput
      id={props.id}
      aria-describedby={props.descriptionId}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      render={(inputProps) => (
        <Input
          {...inputProps}
          className={
            props.tokens !== undefined
              ? "h-auto min-h-7 min-w-40 flex-1 border-0 bg-transparent px-1 py-0 shadow-none focus-visible:border-0 focus-visible:ring-0"
              : showClear
                ? "pr-18"
                : "pr-10"
          }
        />
      )}
    />
  );
  return (
    <div
      ref={container}
      onKeyDownCapture={(event) => {
        // Token buttons and nested dialogs own their own keyboard interactions.
        if (
          !(event.target instanceof HTMLInputElement) ||
          event.target.id !== props.id
        )
          return;
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (
          event.key === "Enter" &&
          (!state.isOpen || state.selectionManager.focusedKey == null)
        ) {
          event.preventDefault();
          event.stopPropagation();
          const first = props.enterSelectsFirst
            ? props.items.find((item) => !props.isItemDisabled?.(item))
            : undefined;
          if (first) state.selectionManager.select(props.getKey(first));
          else props.onCommit?.();
        } else if (
          event.key === "Backspace" &&
          !props.query &&
          props.onRemoveLast
        ) {
          event.preventDefault();
          props.onRemoveLast();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement)
          event.preventDefault();
      }}
    >
      {props.tokens !== undefined ? (
        <TokenInput
          id={props.id}
          field={field}
          preserveHoverRows={props.preserveHoverRows}
        >
          {props.tokens}
        </TokenInput>
      ) : (
        <div className="relative">
          {field}
          {props.inputSuffix ?? (
            <>
              {showClear ? (
                <Button
                  slot={null}
                  aria-label={`清除${props.label}`}
                  isDisabled={props.disabled}
                  onPress={() => {
                    props.onClear?.();
                    document.getElementById(props.id)?.focus();
                  }}
                  className="absolute inset-y-0 right-10 flex w-8 cursor-pointer items-center justify-center rounded-md text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              ) : null}
              <Button
                aria-label={`展开${props.label}搜索结果`}
                className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center rounded-r-md text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronDown className="size-4" aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      )}
      <Popover
        placement="bottom start"
        offset={4}
        maxHeight={288}
        triggerRef={container}
        UNSTABLE_portalContainer={container.current ?? undefined}
        className="z-50 flex w-[var(--trigger-width)] flex-col overflow-hidden rounded-md border border-border bg-card p-1 shadow-surface"
      >
        <ListBox<T>
          aria-label={`${props.label}搜索结果`}
          aria-busy={props.loading}
          className="min-h-0 overflow-y-auto outline-none"
          renderEmptyState={() => props.emptyState}
        >
          {(item) => (
            <ListBoxItem
              id={props.getKey(item)}
              textValue={props.getText(item)}
              className={cn(
                "flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 text-sm outline-none data-focused:bg-primary/10 data-focused:text-primary data-disabled:cursor-not-allowed data-disabled:opacity-50",
                props.itemClassName,
                props.selectedKey !== undefined &&
                  "data-selected:bg-primary/10 data-selected:text-primary data-selected:font-semibold",
              )}
            >
              {({ isSelected }) => (
                <>
                  {props.renderItem(item)}
                  {props.selectedKey !== undefined && isSelected ? (
                    <Check
                      aria-hidden="true"
                      className="ml-auto size-4 shrink-0"
                    />
                  ) : null}
                </>
              )}
            </ListBoxItem>
          )}
        </ListBox>
        {props.footer}
      </Popover>
    </div>
  );
}
