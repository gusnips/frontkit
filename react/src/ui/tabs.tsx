import { Tabs as Primitive } from "@base-ui/react/tabs";
import { cn } from "../cn.ts";
import { mergeClassName } from "./class-name.ts";

// Root and Panel pass straight through: a wrapper around either would add a class string and
// nothing else, and Base UI already owns arrow-key navigation, activation mode and the
// tab/panel `aria-controls` wiring.
export const Tabs = Primitive.Root;
export const TabPanel = Primitive.Panel;

type TabListLabel =
  | { label: string; "aria-labelledby"?: undefined }
  | { label?: undefined; "aria-labelledby": string };

export type TabListProps = Omit<Primitive.List.Props, "aria-labelledby"> &
  TabListLabel & {
    /** Classes for the scroll wrapper — the element that owns the sideways scroll. */
    wrapperClassName?: string;
  };

/**
 * The rail, and the reason this file exists.
 *
 * It scrolls sideways rather than wrapping, because a second row of tabs pushes the panel
 * below the fold on a phone. But the scroll cannot live on the rail itself: `overflow-x: auto`
 * makes the element a scroll container, a scroll container clips everything its children paint
 * outside the padding box, and a computed `overflow-x` of `auto` forces `overflow-y` from
 * `visible` to `auto` as well. A self-scrolling rail therefore crops the focus ring on all
 * FOUR sides of whichever tab the keyboard is on — top and bottom always, the left of the
 * first tab and the right of the last.
 *
 * So the scroll goes on a wrapper, and the wrapper's padding is the room the ring needs. The
 * number is derived, not inherited: `@gusnips/tokens` draws `outline: 2px solid` at
 * `outline-offset: 2px`, so the ring paints from 2px to 4px beyond a tab's border box, and
 * `p-1` is exactly those 4px. An outline reaches FURTHER than the `ring-2` box-shadow the
 * donor had here, so the wrapper matters more now than it did there, not less.
 *
 * Naming the rail is not optional and not a comment: pass `label`, or point
 * `aria-labelledby` at a heading. A tablist with neither is announced as nothing at all.
 */
export function TabList({ label, className, wrapperClassName, children, ...rest }: TabListProps) {
  return (
    <div className={cn("w-fit max-w-full overflow-x-auto p-1", wrapperClassName)}>
      <Primitive.List
        aria-label={label}
        {...rest}
        // `relative`, because TabIndicator positions itself against the rail.
        className={mergeClassName("relative flex w-fit", className)}
      >
        {children}
      </Primitive.List>
    </div>
  );
}

// Styled off `aria-selected`, never a parallel `data-active`: the primitive writes both from
// one state, and styling the accessibility contract is what keeps what a screen reader
// announces and what an eye sees from ever drifting apart.
//
// `shrink-0` and `whitespace-nowrap` are what make the rail scroll instead of squashing — a
// tab that shrinks to fit is a tab nobody can read, and the scroll above exists precisely so
// it does not have to.
const tabClasses =
  "shrink-0 cursor-pointer px-3 py-1.5 whitespace-nowrap text-muted-foreground select-none aria-selected:text-foreground [@media(pointer:coarse)]:min-h-11";

export function Tab({ className, ...rest }: Primitive.Tab.Props) {
  return <Primitive.Tab {...rest} className={mergeClassName(tabClasses, className)} />;
}

/**
 * The travelling marker under the active tab — a SEPARATE part, because the two donors
 * disagreed about whether to have one at all and both were right about their own app. Render
 * it or do not; the rail works either way.
 *
 * It must be a child of `TabList`: Base UI measures the active tab against the enclosing
 * `[role="tablist"]` and writes `--active-tab-left` / `--active-tab-width` onto this element.
 *
 * `renderBeforeHydration` is on by default because this package's apps are prerendered — with
 * it off, every prerendered page shows the rail with no marker until React arrives. It writes
 * one inline script to do that; under a strict CSP without Base UI's `CspProvider` the script
 * is blocked and the behaviour falls back to exactly what `false` would have done.
 */
export function TabIndicator({ className, ...rest }: Primitive.Indicator.Props) {
  return (
    <Primitive.Indicator
      aria-hidden="true"
      renderBeforeHydration
      {...rest}
      className={mergeClassName(
        "absolute bottom-0 left-0 h-0.5 w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] bg-foreground transition-[translate,width]",
        className,
      )}
    />
  );
}
