import { Input as Primitive } from "@base-ui/react/input";
import * as React from "react";
import { cn } from "../cn.ts";

/** Below this width a textarea wraps almost every word, so `scrollHeight` jumps straight to
 *  the cap and the field opens to full height for one word. Under it, let CSS decide. */
const TEXTAREA_MIN_AUTO_WIDTH = 180;
/** Past this the textarea stops growing and starts scrolling, so a long paste cannot push
 *  the submit button off the screen. */
const TEXTAREA_MAX_HEIGHT = 160;

/**
 * The inline height an autosizing textarea should carry, or `""` for "leave it to CSS".
 *
 * ponytail: this whole observer is here only until `field-sizing: content` is baseline —
 * one CSS line does the same job. Ceiling: it does not exist in every browser we support yet.
 */
export function textareaHeight(clientWidth: number, scrollHeight: number): string {
  if (clientWidth < TEXTAREA_MIN_AUTO_WIDTH) return "";
  return `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
}

type FieldChrome = {
  label?: React.ReactNode;
  /**
   * The message under the field. Its presence is what wires `aria-invalid` and
   * `aria-describedby`, so a field that looks wrong also announces that it is.
   */
  error?: React.ReactNode;
  /**
   * Classes for the control. A plain string here, not Base UI's state-callback form: this
   * component renders a native `<textarea>` for the multiline case, which has no Base UI
   * state to call back with, and one field type styling differently from the other would be
   * a worse trade than the callback is worth.
   */
  className?: string;
  wrapperClassName?: string;
  labelClassName?: string;
  errorClassName?: string;
};

export type InputProps = FieldChrome & Omit<Primitive.Props, "className"> & { multiline?: false };

export type MultilineInputProps = FieldChrome &
  Omit<React.ComponentProps<"textarea">, "className"> & { multiline: true };

export type FieldProps = InputProps | MultilineInputProps;

function withoutChrome<P extends FieldChrome & { multiline?: boolean }>(props: P) {
  const {
    label: _label,
    error: _error,
    className: _className,
    wrapperClassName: _wrapperClassName,
    labelClassName: _labelClassName,
    errorClassName: _errorClassName,
    multiline: _multiline,
    ...rest
  } = props;
  return rest;
}

/**
 * `border-input` rather than `border-border`: a control's boundary is a non-text contrast
 * target and has to clear 3:1 (WCAG 1.4.11), which the hairline between two panels does not.
 *
 * `text-base` up to `md`: iOS Safari zooms the whole page in when a field it focuses has type
 * smaller than 16px, and it does not zoom back out. The pair is the fix, not a size choice.
 *
 * No focus style here, deliberately. The app's one ring is the `:focus-visible` outline in
 * `@gusnips/tokens`' base layer, and a control that swaps it for `outline-none` plus a
 * `ring-*` gains nothing and loses forced-colors mode: a ring is a `box-shadow`, which the UA
 * forces to `none` under Windows High Contrast, while an outline survives and takes a system
 * colour. The swap therefore deletes the focus indicator for exactly the people who need it
 * most — and it is invisible in review, because it looks correct in every normal browser.
 */
const controlClasses =
  "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive md:text-sm";

/**
 * A field with its label, its error, and the aria that ties the three together.
 *
 * That wiring is the reason this exists: `htmlFor`/`id`, `aria-describedby` pointing at the
 * error, `aria-invalid` set from the same prop that draws the red border, and an id generated
 * when the caller has not given one. Every one of those is a line somebody forgets, and
 * forgetting it is invisible until a screen reader reads the field with no name and no reason.
 */
export function Input(props: FieldProps) {
  const { label, error, className, wrapperClassName, labelClassName, errorClassName } = props;
  const generatedId = React.useId();
  const fieldId = props.id ?? (label || error ? generatedId : undefined);
  const errorId = error ? `${fieldId ?? generatedId}-error` : undefined;
  // Appended, never replaced: a caller describing the field with a hint of their own keeps it.
  const describedBy = errorId
    ? [props["aria-describedby"], errorId].filter(Boolean).join(" ")
    : props["aria-describedby"];

  const shared = {
    id: fieldId,
    "aria-invalid": error ? true : props["aria-invalid"],
    "aria-describedby": describedBy,
    className: cn(controlClasses, props.multiline && "resize-none", className),
  };

  return (
    <div className={cn("w-full", wrapperClassName)}>
      {label ? (
        <label htmlFor={fieldId} className={cn("mb-1.5 block text-sm", labelClassName)}>
          {label}
        </label>
      ) : null}
      {props.multiline ? (
        <AutosizeTextarea {...withoutChrome(props)} {...shared} />
      ) : (
        <Primitive {...withoutChrome(props)} {...shared} />
      )}
      {error ? (
        <div
          id={errorId}
          role="alert"
          className={cn("mt-1.5 text-xs text-destructive", errorClassName)}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A textarea that grows with its content and then scrolls.
 *
 * It watches its own SIZE, not just its value: a textarea also reflows when the column it
 * sits in changes width — a drawer opening, a sidebar collapsing, a phone turning — and
 * height set from the old width is either a gap under the text or a scrollbar over two lines.
 */
function AutosizeTextarea({ ref, onInput, ...rest }: React.ComponentProps<"textarea">) {
  const element = React.useRef<HTMLTextAreaElement | null>(null);

  const setElement = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      element.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const fit = React.useCallback(() => {
    const node = element.current;
    if (!node) return;
    // Reset first. `scrollHeight` is the content height OR the box height, whichever is
    // larger, so a box already held open at yesterday's height never reports a smaller one —
    // the field would grow and never shrink.
    node.style.height = "auto";
    node.style.height = textareaHeight(node.clientWidth, node.scrollHeight);
  }, []);

  React.useEffect(() => {
    fit();
  }, [fit, rest.value, rest.placeholder]);

  React.useEffect(() => {
    const node = element.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [fit]);

  return (
    <textarea
      {...rest}
      ref={setElement}
      onInput={(event) => {
        fit();
        onInput?.(event);
      }}
    />
  );
}
