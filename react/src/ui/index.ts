// @gusnips/react/ui — the Base UI wrappers, behind a subpath so an app on a different
// primitive library (or none) never resolves `@base-ui/react`.
//
// SEVEN, out of twenty-seven in the donor. The rest added a class string and nothing else:
// Base UI already does scroll lock, focus trap, escape, outside-dismiss, focus return, roving
// focus and typeahead, so a wrapper earns its place for one of three reasons only —
// composition a caller cannot skip (a dialog with no scrim is unwritable), a required a11y
// prop expressed as a TYPE (no close button without its label, no tab rail without a name),
// or an encoded gotcha (the drawer's four, the menu's caption, the tab rail's padding).
//
// These are not styled components. The classes here are the ones that make the primitive
// work — position, stacking, overflow, an opaque surface, the transition hooks Base UI
// animates through. Padding, radius, shadow and type are the product's, and every part takes
// a `className` that wins over ours.
//
// Nothing here draws a focus ring, and nothing removes one outside a popup container. The
// app's single `:focus-visible` outline lives in `@gusnips/tokens`' base layer; a wrapper
// that swaps it for a `ring-*` box-shadow looks identical in every normal browser and
// vanishes under `forced-colors: active`. `focus.test.ts` pins that.
//
// The stacking contract, in one place, because the parts are all portalled to `<body>` and
// nesting decides nothing:
//   z-40  drawer backdrop
//   z-50  the overlay layer — dialog, drawer. A tie on purpose: a dialog opened from inside
//         a drawer must paint over it, and at a tie the later portal wins.
//   z-60  popups anchored inside that layer — a select, combobox or menu opened in a dialog.
//         Every one of the three takes `positionerProps={{ className: "z-…" }}` to move.

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

// `SelectGroupLabel` and `ComboboxGroupLabel` below ARE exported, and the menu's is not. The
// hazard is identical — all three read their group's context and throw when written outside
// it, reported in production as `Base UI error #56` for select, `#18` for combobox and `#31`
// for the menu — so the difference is a decision, not an oversight.
//
// It turns on what the wrapper already covers. `MenuGroup` composes the caption as a `label`
// prop, so the raw part has no job left and withholding it is free. `Select` and `Combobox`
// take a flat option list and cannot express a grouped one at all, so these are the escape
// hatch for that shape — and a caller reaching for `SelectGroup` is writing its
// `SelectGroupLabel` in the same breath, which is the arrangement that works.
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

// No `MenuGroupLabel`, and no raw `Group` / `RadioGroup`. That is the whole guarantee — see
// the note at the top of menu.tsx.
export {
  Menu,
  MenuArrow,
  MenuBackdrop,
  MenuCheckboxItem,
  MenuCheckboxItemIndicator,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLinkItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuSubmenuRoot,
  MenuSubmenuTrigger,
  MenuTrigger,
  type MenuContentProps,
  type MenuRadioItemProps,
} from "./menu.tsx";

export { Tab, TabIndicator, TabList, TabPanel, Tabs, type TabListProps } from "./tabs.tsx";
