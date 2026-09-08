// @gusnips/react/ui — five Base UI wrappers, behind a subpath so an app on a different
// primitive library (or none) never resolves `@base-ui/react`.
//
// FIVE, out of twenty-seven in the donor. The other twenty-two added a class string and
// nothing else: Base UI already does scroll lock, focus trap, escape, outside-dismiss, focus
// return, roving focus and typeahead, so a wrapper earns its place for one of three reasons
// only — composition a caller cannot skip (a dialog with no scrim is unwritable), a required
// a11y prop expressed as a TYPE (no close button without its label), or an encoded gotcha
// (the drawer's four).
//
// These are not styled components. The classes here are the ones that make the primitive
// work — position, stacking, overflow, an opaque surface, the transition hooks Base UI
// animates through. Padding, radius, shadow and type are the product's, and every part takes
// a `className` that wins over ours.
//
// The stacking contract, in one place, because the parts are all portalled to `<body>` and
// nesting decides nothing:
//   z-40  drawer backdrop
//   z-50  the overlay layer — dialog, drawer. A tie on purpose: a dialog opened from inside
//         a drawer must paint over it, and at a tie the later portal wins.
//   z-60  popups anchored inside that layer — a select or combobox list opened in a dialog.

export { mergeClassName, type StateClassName } from "./class-name.ts";

export {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  type DialogContentProps,
} from "./dialog.tsx";

export {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHandle,
  DrawerPopup,
  DrawerPortal,
  DrawerRoot,
  DrawerSwipeArea,
  DrawerTitle,
  DrawerTrigger,
  DrawerViewport,
  type DrawerProps,
  type DrawerSide,
} from "./drawer.tsx";

export {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectRoot,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  type SelectOption,
  type SelectProps,
} from "./select.tsx";

export {
  Combobox,
  comboboxInputValue,
  ComboboxClear,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxRoot,
  ComboboxTrigger,
  type ComboboxProps,
} from "./combobox.tsx";

export {
  Input,
  textareaHeight,
  type FieldProps,
  type InputProps,
  type MultilineInputProps,
} from "./input.tsx";
