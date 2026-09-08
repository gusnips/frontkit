// The three affordance marks the wrappers draw by default: the chevron that says "this
// opens", the check that says "this one is picked", the cross that says "this closes".
//
// They are `currentColor` stroke on a 24-grid so a product's own icon set drops in without
// a size or colour change. Every component that draws one takes it as a prop — these are the
// zero-config default, never the only option.

function Glyph({ d }: { d: string }) {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export function ChevronGlyph() {
  return <Glyph d="m6 9 6 6 6-6" />;
}

export function CheckGlyph() {
  return <Glyph d="m5 13 4 4 10-10" />;
}

export function CloseGlyph() {
  return <Glyph d="M18 6 6 18M6 6l12 12" />;
}
