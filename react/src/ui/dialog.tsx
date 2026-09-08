import { Dialog as Primitive } from "@base-ui/react/dialog";
import { mergeClassName, type StateClassName } from "./class-name.ts";
import { CloseGlyph } from "./glyphs.tsx";

// The parts, straight through. Base UI already does focus trap, escape, outside-dismiss,
// scroll lock, focus return and the aria wiring, and a wrapper around any of these would only
// add a class name — so they are re-exported, not re-implemented.
export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;
export const DialogClose = Primitive.Close;
export const DialogPortal = Primitive.Portal;
export const DialogBackdrop = Primitive.Backdrop;
export const DialogPopup = Primitive.Popup;

export type DialogContentProps = Primitive.Popup.Props & {
  /**
   * Accessible name, for a dialog with no visible `DialogTitle`. With a title, leave this
   * out: Base UI points the popup's `aria-labelledby` at it, and an `aria-label` here would
   * override the words the user can actually see.
   */
  label?: string;
  /**
   * Label for the built-in close button — REQUIRED to get one, which is the whole point:
   * passing the label is the only way to render the button, so an unlabelled close button
   * cannot be written. There is no default string, because a default would be English.
   */
  closeLabel?: string;
  backdropClassName?: StateClassName<Primitive.Backdrop.State>;
  /** Where the portal mounts. Defaults to `<body>`. */
  container?: Primitive.Portal.Props["container"];
};

/**
 * Portal + backdrop + popup as one part, so a scrimless dialog is not a thing a caller can
 * ship by forgetting a line. The popup owns the scroll (`overflow-y-auto` plus
 * `overscroll-contain`, so reaching the end of a long dialog does not start scrolling the
 * page behind it) and is capped to the viewport, so a tall dialog is never taller than the
 * screen it opens on.
 *
 * Everything else — padding, radius, shadow, type — is the product's. What is here is what
 * makes the primitive work.
 */
export function DialogContent({
  className,
  backdropClassName,
  container,
  label,
  closeLabel,
  children,
  ...rest
}: DialogContentProps) {
  return (
    <Primitive.Portal container={container}>
      <Primitive.Backdrop
        className={mergeClassName(
          "fixed inset-0 z-50 bg-scrim transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0",
          backdropClassName,
        )}
      />
      {/* `outline-none` belongs on a popup and almost nowhere else: this element takes
          programmatic focus the moment it opens, and a focus ring is meant to answer a
          keyboard, not to frame every dialog that appears. Controls inside keep theirs. */}
      <Primitive.Popup
        aria-label={label}
        {...rest}
        className={mergeClassName(
          "fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain bg-popover text-popover-foreground outline-none transition-[scale,opacity] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
          className,
        )}
      >
        {children}
        {closeLabel === undefined ? null : (
          <Primitive.Close
            aria-label={closeLabel}
            // 44px square: the close button is often the only way out on a phone, and a
            // smaller target is one a thumb misses.
            className="absolute top-0 right-0 inline-flex size-11 items-center justify-center text-muted-foreground"
          >
            <CloseGlyph />
          </Primitive.Close>
        )}
      </Primitive.Popup>
    </Primitive.Portal>
  );
}
