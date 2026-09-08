import { Menu as Primitive } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { mergeClassName } from "./class-name.ts";
import { CheckGlyph } from "./glyphs.tsx";

// The parts — every one of them EXCEPT `GroupLabel`, and every one except `Group` and
// `RadioGroup`, which are wrapped below. That omission is not tidying: it is the only thing
// that actually prevents the bug. `Menu.GroupLabel` reads its group's context, so a caption
// written as a SIBLING of the group throws at render — and in a production build the message
// is the bare number 31, with nothing naming the file or the part. A comment cannot stop
// that; not shipping the part can. The caption is a prop on the group instead, so the wrong
// arrangement has nowhere to be written.
export const Menu = Primitive.Root;
export const MenuTrigger = Primitive.Trigger;
export const MenuPortal = Primitive.Portal;
export const MenuPositioner = Primitive.Positioner;
export const MenuPopup = Primitive.Popup;
export const MenuBackdrop = Primitive.Backdrop;
export const MenuArrow = Primitive.Arrow;
export const MenuLinkItem = Primitive.LinkItem;
export const MenuCheckboxItem = Primitive.CheckboxItem;
export const MenuCheckboxItemIndicator = Primitive.CheckboxItemIndicator;
export const MenuRadioItemIndicator = Primitive.RadioItemIndicator;
export const MenuSubmenuRoot = Primitive.SubmenuRoot;
export const MenuSubmenuTrigger = Primitive.SubmenuTrigger;

export type MenuContentProps = Primitive.Popup.Props & {
  /**
   * Accessible name for the menu. Usually leave this out: Base UI already points the popup's
   * `aria-labelledby` at whichever trigger opened it, so a name here REPLACES the words on
   * the button a screen reader just read. Pass it only when the menu is about something the
   * trigger does not say.
   */
  label?: string;
  /** Where the portal mounts. Defaults to `<body>`. */
  container?: Primitive.Portal.Props["container"];
  /**
   * Positioner props — `side`, `align`, `sideOffset`, `collisionPadding`, and the stacking
   * order. The default `z-[60]` puts the menu above the overlay layer (z-50: dialog, drawer)
   * so a menu opened inside a dialog is not painted behind it; raise it with
   * `positionerProps={{ className: "z-[80]" }}` if the app stacks something higher.
   */
  positionerProps?: Primitive.Positioner.Props;
};

/**
 * A dropdown of decisions — the account menu, a row's actions, a picker. Portal, positioner
 * and popup composed once, for the same reason the dialog's are: the arrangement is not
 * optional and getting it wrong throws a number.
 *
 * Roving focus, typeahead, escape, outside-dismiss and focus return all come from Base UI.
 * Nothing here re-implements any of them.
 */
export function MenuContent({
  className,
  children,
  label,
  container,
  positionerProps,
  ...rest
}: MenuContentProps) {
  return (
    <Primitive.Portal container={container}>
      <Primitive.Positioner
        side="bottom"
        align="end"
        sideOffset={6}
        {...positionerProps}
        className={mergeClassName(
          "z-[60] max-w-[var(--available-width)]",
          positionerProps?.className,
        )}
      >
        {/* `outline-none` on the popup and nowhere else in this file: the popup takes focus
            programmatically the moment it opens, and the ring is meant to answer a keyboard,
            not to frame a panel that just appeared. The items keep theirs — see below. */}
        <Primitive.Popup
          aria-label={label}
          {...rest}
          className={mergeClassName(
            "max-h-[var(--available-height)] min-w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-y-auto border border-border bg-popover text-popover-foreground outline-none transition-[scale,opacity] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            className,
          )}
        >
          {children}
        </Primitive.Popup>
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}

/**
 * Base UI gives the highlighted item a real `tabIndex: 0` and moves DOM focus to it, so a
 * keyboard user gets the app's `:focus-visible` outline for free and `data-highlighted` draws
 * the pointer's highlight. Nothing here suppresses either — a menu row is one of the places
 * the ring is most needed and most often deleted.
 *
 * The coarse-pointer minimum is a 44px row: a thumb misses anything smaller, and a menu is
 * usually a list of one-way actions.
 */
const itemClasses =
  "flex cursor-default items-center gap-2 px-3 py-1.5 select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground [@media(pointer:coarse)]:min-h-11";

export function MenuItem({ className, ...rest }: Primitive.Item.Props) {
  return <Primitive.Item {...rest} className={mergeClassName(itemClasses, className)} />;
}

export function MenuSeparator({ className, ...rest }: Primitive.Separator.Props) {
  return (
    <Primitive.Separator {...rest} className={mergeClassName("my-1 h-px bg-border", className)} />
  );
}

/** The caption a group is named by, or nothing. Never a part you place yourself. */
type MenuGroupCaption = { label?: string };

const captionClasses = "px-3 pt-2 pb-1 text-muted-foreground";

/**
 * A set of related items with an optional caption.
 *
 * The caption is a PROP because that is the only arrangement that cannot be got wrong: it
 * lands inside the group, which is both what stops Base UI throwing and what gives the set
 * its `aria-labelledby`. It is also not focusable, so it never eats an arrow-key stop.
 * Optional, because a group whose trigger already says what it is would only repeat itself.
 */
export function MenuGroup({ label, children, ...rest }: Primitive.Group.Props & MenuGroupCaption) {
  return (
    <Primitive.Group {...rest}>
      {label === undefined ? null : (
        <Primitive.GroupLabel className={captionClasses}>{label}</Primitive.GroupLabel>
      )}
      {children}
    </Primitive.Group>
  );
}

/** A set of choices — theme, locale, one axis of a filter. Same caption rule as `MenuGroup`. */
export function MenuRadioGroup({
  label,
  children,
  ...rest
}: Primitive.RadioGroup.Props & MenuGroupCaption) {
  return (
    <Primitive.RadioGroup {...rest}>
      {label === undefined ? null : (
        <Primitive.GroupLabel className={captionClasses}>{label}</Primitive.GroupLabel>
      )}
      {children}
    </Primitive.RadioGroup>
  );
}

export type MenuRadioItemProps = Primitive.RadioItem.Props & {
  /** Mark for the chosen item. */
  indicator?: ReactNode;
};

/**
 * One choice in a set. The mark keeps a fixed leading column whether or not it is showing, so
 * the labels do not shift sideways when the selection moves.
 */
export function MenuRadioItem({ className, children, indicator, ...rest }: MenuRadioItemProps) {
  return (
    <Primitive.RadioItem
      {...rest}
      className={mergeClassName([itemClasses, "data-checked:text-foreground"], className)}
    >
      <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
        <Primitive.RadioItemIndicator>{indicator ?? <CheckGlyph />}</Primitive.RadioItemIndicator>
      </span>
      {children}
    </Primitive.RadioItem>
  );
}
