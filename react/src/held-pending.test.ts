// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHeldPending } from "./held-pending.ts";

// A refresh that answers in 80 ms flipped `pending` on and off inside a frame, so the button never
// visibly changed and the reader thought the press was ignored. The flag has to stay on for the
// minimum once it turns on, and a slow request must not be made to wait any longer.

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const roots = new Set<Root>();

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.clear();
  document.body.replaceChildren();
  vi.useRealTimers();
});

function mount(initial: boolean, minMs?: number) {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  roots.add(root);
  const seen: boolean[] = [];

  function Probe({ pending }: { pending: boolean }) {
    const held = useHeldPending(pending, minMs);
    seen.push(held);
    return null;
  }

  const render = (pending: boolean) => act(() => root.render(createElement(Probe, { pending })));
  render(initial);
  return { render, current: () => seen.at(-1) };
}

describe("useHeldPending", () => {
  it("is false while nothing is pending", () => {
    expect(mount(false).current()).toBe(false);
  });

  it("is true on the very render pending starts true, with no wait for an effect", () => {
    const { render, current } = mount(false);
    render(true);
    expect(current()).toBe(true);
  });

  it("holds a request that ended early until the minimum has passed", () => {
    const { render, current } = mount(false, 400);
    render(true);
    act(() => void vi.advanceTimersByTime(80));
    render(false);
    expect(current()).toBe(true);
    act(() => void vi.advanceTimersByTime(319));
    expect(current()).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(current()).toBe(false);
  });

  it("does not make a slow request wait longer than one timer tick", () => {
    const { render, current } = mount(false, 400);
    render(true);
    act(() => void vi.advanceTimersByTime(900));
    render(false);
    act(() => void vi.advanceTimersByTime(0));
    expect(current()).toBe(false);
  });

  it("starts the clock again when it turns on a second time", () => {
    const { render, current } = mount(false, 400);
    render(true);
    act(() => void vi.advanceTimersByTime(100));
    render(false);
    act(() => void vi.advanceTimersByTime(300));
    expect(current()).toBe(false);
    render(true);
    act(() => void vi.advanceTimersByTime(50));
    render(false);
    expect(current()).toBe(true);
    act(() => void vi.advanceTimersByTime(350));
    expect(current()).toBe(false);
  });
});
