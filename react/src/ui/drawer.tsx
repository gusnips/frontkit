import { Drawer as Primitive } from "@base-ui/react/drawer";
import type { ReactNode } from "react";
import { mergeClassName, type StateClassName } from "./class-name.ts";

// The parts, for a drawer that needs a shape this wrapper does not give it.
export const DrawerRoot = Primitive.Root;
export const DrawerTrigger = Primitive.Trigger;
export const DrawerPortal = Primitive.Portal;
export const DrawerBackdrop = Primitive.Backdrop;
export const DrawerViewport = Primitive.Viewport;
export const DrawerPopup = Primitive.Popup;
export const DrawerContent = Primitive.Content;
export const DrawerHandle = Primitive.Handle;
export const DrawerSwipeArea = Primitive.SwipeArea;
export const DrawerTitle = Primitive.Title;
export const DrawerDescription = Primitive.Description;
export const DrawerClose = Primitive.Close;

export type DrawerSide = "left" | "right" | "bottom";

const viewportSide: Record<DrawerSide, string> = {
  left: "items-stretch justify-start",
  right: "items-stretch justify-end",
  bottom: "items-end",
};

// The translate pair is what Base UI animates between: `data-starting-style` is the frame
// before it opens, `data-ending-style` the frame it leaves on. Same class both ways, so the
// drawer goes back out the side it came in.
const popupSide: Record<DrawerSide, string> = {
  left: "w-[min(24rem,calc(100vw-1rem))] data-ending-style:-translate-x-full data-starting-style:-translate-x-full",
  right:
    "w-[min(24rem,calc(100vw-1rem))] data-ending-style:translate-x-full data-starting-style:translate-x-full",
  bottom:
    "max-h-[90svh] w-full data-ending-style:translate-y-full data-starting-style:translate-y-full",
};

/**
 * Where the portal mounts, and whether the drawer covers the page or a box inside it.
 *
 * A scoped drawer positions itself `absolute` against a container instead of `fixed` against
 * the viewport — so it MUST be given that container, or it lands in `<body>` and positions
 * against a box that is not there. The two travel together in the type.
 *
 * The container also needs a positioning context of its own (`relative`): `absolute` walks up
 * to the nearest positioned ancestor, so a static container hands the drawer the whole page
 * and the "scoped" part quietly does not happen.
 */
type DrawerPortalTarget =
  | { scoped: true; container: NonNullable<Primitive.Portal.Props["container"]> }
  | { scoped?: false; container?: Primitive.Portal.Props["container"] };

export type DrawerProps<Payload = unknown> = Omit<
  Primitive.Root.Props<Payload>,
  "children" | "swipeDirection"
> &
  DrawerPortalTarget & {
    /**
     * Which edge it comes from. This also sets `swipeDirection` on the root — the two must
     * agree, and a mismatch is silent: the drawer looks right and dismisses on a swipe
     * towards the screen it is attached to.
     */
    side?: DrawerSide;
    /** Accessible name, for a drawer with no visible `DrawerTitle`. */
    label?: string;
    children?: ReactNode;
    /** Classes for the popup — the panel itself. */
    className?: StateClassName<Primitive.Popup.State>;
    backdropClassName?: StateClassName<Primitive.Backdrop.State>;
    viewportClassName?: StateClassName<Primitive.Viewport.State>;
    contentClassName?: StateClassName<Primitive.Content.State>;
    /** Popup-level props the wrapper does not own — `initialFocus`, `finalFocus`, `data-*`. */
    popupProps?: Primitive.Popup.Props;
  };

/**
 * A panel that slides in from an edge. Root → portal → backdrop → viewport → popup → content,
 * composed once here because the parts have to be arranged in exactly this order to work at
 * all, and because two of the four rules below cost someone a bug that no test would catch.
 *
 * Everything the root takes — `open`, `onOpenChange`, `modal`, `snapPoints`, `actionsRef`,
 * `data-*` — passes straight through.
 */
export function Drawer<Payload = unknown>({
  side = "right",
  label,
  scoped = false,
  container,
  className,
  backdropClassName,
  viewportClassName,
  contentClassName,
  popupProps,
  children,
  ...rest
}: DrawerProps<Payload>) {
  return (
    <Primitive.Root swipeDirection={side === "bottom" ? "down" : side} {...rest}>
      {/* Base UI throws (error #26) if any drawer part sits outside a Portal, so the scoped
          variant does not skip the portal — it portals INTO its container and positions
          absolutely there. */}
      <Primitive.Portal container={container}>
        <Primitive.Backdrop
          className={mergeClassName(
            [
              scoped ? "absolute" : "fixed",
              "inset-0 z-40 bg-scrim transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0",
            ],
            backdropClassName,
          )}
        />
        {/* The z-index lives on the VIEWPORT, not on the popup. `position: fixed` always
            creates a stacking context, so a z on the popup would only rank it inside the
            viewport's own `z-auto` context — which paints under every positioned z-30+
            element on the page (header, sidebar, floating buttons) however high that z is.

            It is z-50, which TIES the dialog layer rather than clearing it, on purpose. A
            drawer hosts whole app surfaces — a mobile nav carries the entire sidebar — and
            those surfaces open dialogs. Rank the drawer above the dialog layer and it paints
            over every modal opened from inside it: the user taps, nothing appears. At a tie
            the dialog wins on DOM order, because it portals to the body after the drawer
            that opened it. */}
        <Primitive.Viewport
          className={mergeClassName(
            [scoped ? "absolute" : "fixed", "inset-0 z-50 flex", viewportSide[side]],
            viewportClassName,
          )}
        >
          <Primitive.Popup
            aria-label={label}
            {...popupProps}
            className={mergeClassName(
              [
                "pointer-events-auto flex flex-col overflow-y-auto overscroll-contain bg-background text-foreground outline-none transition-transform",
                popupSide[side],
              ],
              className,
            )}
          >
            <Primitive.Content
              className={mergeClassName(
                [
                  "flex w-full flex-1 flex-col",
                  // A side drawer has a definite height (the viewport's), so cap the content
                  // to it. Without `min-h-0` a child with its own scroll region grows the
                  // popup instead of scrolling inside it, and the footer that was meant to
                  // stay pinned ends up at the bottom of one long page scroll. A bottom
                  // drawer sizes from its content, so it keeps the default `min-height: auto`.
                  side !== "bottom" && "min-h-0",
                ],
                contentClassName,
              )}
            >
              {children}
            </Primitive.Content>
          </Primitive.Popup>
        </Primitive.Viewport>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
