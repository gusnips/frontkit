import { Select as Primitive } from "@base-ui/react/select";
import type { ReactNode } from "react";
import { mergeClassName, type StateClassName } from "./class-name.ts";
import { CheckGlyph, ChevronGlyph } from "./glyphs.tsx";

// The parts, for a select this wrapper's option list cannot express — groups, separators,
// a scrollable list with arrows.
export const SelectRoot = Primitive.Root;
export const SelectTrigger = Primitive.Trigger;
export const SelectValue = Primitive.Value;
export const SelectIcon = Primitive.Icon;
export const SelectPortal = Primitive.Portal;
export const SelectPositioner = Primitive.Positioner;
export const SelectPopup = Primitive.Popup;
export const SelectList = Primitive.List;
export const SelectItem = Primitive.Item;
export const SelectItemIndicator = Primitive.ItemIndicator;
export const SelectItemText = Primitive.ItemText;
export const SelectGroup = Primitive.Group;
export const SelectGroupLabel = Primitive.GroupLabel;
export const SelectSeparator = Primitive.Separator;

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
  icon?: ReactNode;
}

export type SelectProps<T extends string = string> = Omit<
  Primitive.Root.Props<T, false>,
  "children" | "items" | "defaultValue" | "multiple"
> & {
  options?: readonly SelectOption<T>[];
  /** Shown while nothing is selected. No default — a default would be English. */
  placeholder?: ReactNode;
  /**
   * Shown instead of the list when `options` is empty. Required, because a popup that opens
   * on nothing is a dead end: this is the line that says why it is empty.
   */
  emptyLabel: ReactNode;
  /**
   * Label of an entry that puts the field back to nothing selected — for an optional
   * question, where "I'd rather not say" has to stay reachable after the first answer.
   * Rendered only once there is a value to take back; picking it calls `onValueChange(null)`.
   */
  clearLabel?: string;
  /** Accessible name for the trigger, when no visible label points at it. */
  label?: string;
  /** Mark that says "this opens". */
  chevron?: ReactNode;
  /** Mark next to the selected option. */
  indicator?: ReactNode;
  /** Classes for the trigger — the button you see when the popup is closed. */
  className?: StateClassName<Primitive.Trigger.State>;
  popupClassName?: StateClassName<Primitive.Popup.State>;
  triggerProps?: Primitive.Trigger.Props;
  positionerProps?: Primitive.Positioner.Props;
};

/**
 * A single-choice field. Trigger, portal, positioner, popup and list composed once; `name`,
 * `form`, `required`, `id`, `disabled` and every other root prop pass straight through to
 * Base UI's hidden input, so this submits inside a `<form>` like a native `<select>`.
 *
 * Controlled only, and that is the point of `value ?? null`: React and Base UI both read
 * `value={undefined}` as "uncontrolled", so a caller holding `T | undefined` in state would
 * silently hand the field back to the primitive the moment the value cleared, and every
 * later render would be ignored. `null` says "nothing selected" out loud. `defaultValue` is
 * not accepted here for the same reason — use the parts for an uncontrolled select.
 */
export function Select<T extends string = string>({
  value,
  options = [],
  placeholder,
  emptyLabel,
  clearLabel,
  label,
  chevron,
  indicator,
  className,
  popupClassName,
  triggerProps,
  positionerProps,
  ...rest
}: SelectProps<T>) {
  const selected = options.find((option) => option.value === value);
  // `undefined` when nothing is selected, and it has to be exactly that. Base UI's Value part
  // falls back to `placeholder` only when it is handed NO children at all — an empty fragment
  // still counts as children, which is how the donor ended up with a select that showed a
  // blank trigger instead of "Choose one".
  const selectedLabel = selected ? (
    <>
      {selected.icon ? (
        <span className="mr-2 inline-flex align-middle">{selected.icon}</span>
      ) : null}
      {selected.label}
    </>
  ) : undefined;

  return (
    <Primitive.Root<T, false> value={value ?? null} items={options} {...rest}>
      <Primitive.Trigger
        aria-label={label}
        {...triggerProps}
        className={mergeClassName(
          // No focus style: the trigger keeps the app's one `:focus-visible` outline. Swapping
          // it for a `ring-*` loses forced-colors mode, where a box-shadow is forced to none.
          "flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-foreground disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
      >
        <Primitive.Value
          placeholder={placeholder}
          className="min-w-0 flex-1 truncate data-placeholder:text-muted-foreground"
        >
          {selectedLabel}
        </Primitive.Value>
        <Primitive.Icon className="shrink-0 text-muted-foreground">
          {chevron ?? <ChevronGlyph />}
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        {/* Above the overlay layer (z-50: dialog, drawer). A select opened inside a dialog
            portals to the body just like the dialog does, so nesting decides nothing and z
            decides everything — one step lower and the list paints behind the panel that
            anchors it. */}
        <Primitive.Positioner
          sideOffset={4}
          {...positionerProps}
          className="z-[60] max-w-[var(--available-width)] outline-none"
        >
          <Primitive.Popup
            className={mergeClassName(
              "min-w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-hidden border border-border bg-popover text-popover-foreground outline-none transition-[scale,opacity] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
              popupClassName,
            )}
          >
            <Primitive.List className="max-h-[var(--available-height)] overflow-y-auto">
              {clearLabel !== undefined && value != null ? (
                // An Item with `value={null}`, not a button above the list: only an item is
                // reachable by arrow keys and typeahead, and only an item closes the popup
                // on its own. `null` is what arrives at `onValueChange`.
                <Primitive.Item
                  value={null}
                  className="flex cursor-default items-center gap-2 px-3 py-2 text-muted-foreground outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="size-4 shrink-0" aria-hidden="true" />
                  <Primitive.ItemText>{clearLabel}</Primitive.ItemText>
                </Primitive.Item>
              ) : null}
              {options.length === 0 ? (
                <div className="px-3 py-2 text-muted-foreground">{emptyLabel}</div>
              ) : (
                options.map((option) => (
                  <Primitive.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className="flex cursor-default items-center gap-2 px-3 py-2 outline-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  >
                    {/* The mark keeps a column of its own whether or not it is showing, so
                        the labels do not shift by 16px when the selection moves. */}
                    <span className="size-4 shrink-0">
                      <Primitive.ItemIndicator>
                        {indicator ?? <CheckGlyph />}
                      </Primitive.ItemIndicator>
                    </span>
                    {option.icon ? (
                      <span className="inline-flex shrink-0">{option.icon}</span>
                    ) : null}
                    <Primitive.ItemText>{option.label}</Primitive.ItemText>
                  </Primitive.Item>
                ))
              )}
            </Primitive.List>
          </Primitive.Popup>
        </Primitive.Positioner>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
