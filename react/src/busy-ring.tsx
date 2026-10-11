/**
 * The ring that runs round a busy control's edge. Put it inside the control while it is busy.
 *
 * It draws nothing by itself: the look lives in `@gusnips/tokens/busy-ring.css`, which you import
 * once. The control needs `position: relative` and the radius it already has (the ring copies it),
 * and its disabled style must not dim it, or the ring is drawn at half strength and nobody sees it.
 *
 * Why a component for one `span`: the class name and the markup are one contract. Changing how
 * busy looks, a second element or another shape, is then one edit here and one release, not one
 * edit in every product's button.
 */
export function BusyRing() {
  return <span aria-hidden="true" className="busy-ring" />;
}
