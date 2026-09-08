import { describe, expect, it } from "vitest";
import { createSseParser, type SseFrame } from "./sse.ts";

function collect(...chunks: string[]): SseFrame[] {
  const frames: SseFrame[] = [];
  const parser = createSseParser((f) => frames.push(f));
  for (const chunk of chunks) parser.feed(chunk);
  return frames;
}

describe("createSseParser", () => {
  // The bug one donor shipped: assigning `data` instead of appending, so a multi-line
  // payload arrived as its last line only. Silent — no error, no warning, a truncated message.
  it("joins repeated data lines instead of overwriting them", () => {
    expect(collect("data: one\ndata: two\ndata: three\n\n")[0]?.data).toBe("one\ntwo\nthree");
  });

  it("holds a frame split across reads until it completes", () => {
    expect(collect("data: hel", "lo\n", "\n")).toEqual([
      { event: "message", data: "hello", id: undefined },
    ]);
  });

  // The spec strips exactly one space after the colon. `.trim()` is the obvious wrong thing:
  // it eats leading and trailing whitespace a payload may actually mean.
  it("strips one leading space, not all whitespace", () => {
    expect(collect("data:  padded \n\n")[0]?.data).toBe(" padded ");
  });

  it("defaults an unnamed frame to `message`, and carries event and id", () => {
    expect(collect("event: tick\nid: 42\ndata: x\n\n")[0]).toEqual({
      event: "tick",
      data: "x",
      id: "42",
    });
  });

  // What lets a server keep the connection warm without waking the consumer on every beat.
  it("does not dispatch a frame with no data", () => {
    expect(collect("event: heartbeat\n\n", ": just a comment\n\n")).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    expect(collect("event: tick\r\ndata: x\r\n\r\n")[0]?.event).toBe("tick");
  });

  it("does not parse the payload", () => {
    expect(collect('data: {"n":1}\n\n')[0]?.data).toBe('{"n":1}');
  });
});
