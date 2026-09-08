/**
 * Server-sent events: the framing and the transport, kept apart.
 *
 * Three donors had three readers and each had half the answer. One was spec-correct about the
 * wire but welded to `TextDecoderStream`, so the React Native app — whose fetch has no body
 * reader — could not use a line of it. One was a platform-free `feed(text)` that three
 * transports shared, and it silently dropped data. One was a whole second transport with its
 * own fetch and its own 401 handling, bypassing the app's only API client.
 *
 * So: {@link createSseParser} is the state machine and knows about no platform at all;
 * {@link readSseStream} is fifteen lines of `ReadableStream` on top of it. A caller on a
 * platform without body readers keeps its own fifteen lines and shares the machine underneath.
 * (providerkit reached this exact split from the other direction and for the same reason.)
 *
 * And streams ride the ordinary API client — `client.request(path, {headers: {Accept:
 * "text/event-stream"}, timeoutMs: null})`. Not `EventSource`, which cannot carry an
 * Authorization header, and not a second fetch, which would need its own copy of the refresh
 * logic and would drift from it.
 */

/** One frame off the wire. `data` is raw text; see {@link createSseParser} on why. */
export interface SseFrame {
  /** The `event:` field, or `"message"` — which is what the spec says an unnamed frame is. */
  event: string;
  /** Every `data:` line in the frame, joined with newlines. Never parsed here. */
  data: string;
  /** The `id:` field, if the server sent one. Feed it back as `Last-Event-ID` to resume. */
  id: string | undefined;
}

/**
 * An incremental parser. Feed it text in whatever sizes the transport delivers.
 *
 * Frames split across reads are held until they complete, so a payload cut mid-line is never
 * lost or truncated — which is the failure this shape exists to prevent, and the one that only
 * shows up under a slow network.
 *
 * Three rules that are easy to get wrong, and one donor got each of them wrong:
 *
 * - **`data:` repeats.** A frame may carry several `data:` lines and they are JOINED with
 *   newlines. One donor assigned instead of appending, so a multi-line payload arrived as its
 *   last line only — no error, no warning, just a truncated message.
 * - **Strip ONE leading space after the colon**, not all whitespace. `.trim()` is the obvious
 *   thing and it corrupts any payload whose own content begins or ends with a space.
 * - **A frame with no `data:` is not dispatched.** That is what lets a server send bare
 *   `event: heartbeat` keepalives, or `:` comment lines, without waking a consumer.
 *
 * `data` is handed back as a raw string and deliberately NOT JSON-parsed. One donor parsed here
 * and its three consumers wanted three different things — one wraps non-JSON, one uses a
 * tolerant parser, one parses directly. Parsing in the parser picks a policy for all of them.
 */
export function createSseParser(onFrame: (frame: SseFrame) => void): {
  feed: (text: string) => void;
} {
  let buffer = "";

  return {
    feed(text: string) {
      // A server may send CRLF; the frame boundary is a blank line either way.
      buffer += text.replace(/\r\n/g, "\n");
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const frame = parseFrame(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (frame) onFrame(frame);
        end = buffer.indexOf("\n\n");
      }
    },
  };
}

/** The SSE wire format: `field: value` lines, `data` repeatable, a leading `:` is a comment. */
function parseFrame(raw: string): SseFrame | null {
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];

  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "id") id = value;
    else if (field === "data") data.push(value);
  }

  return data.length === 0 ? null : { event, data: data.join("\n"), id };
}

/**
 * Read a `Response` body as SSE. Resolves when the server closes the stream.
 *
 * Pass the response from the ordinary API client, so the stream inherits the token, the
 * single-flight refresh, and a 402 or a 404 arriving as an `ApiError` the page can explain
 * rather than an `onerror` event with nothing in it.
 *
 * Cancels the reader on the way out however it leaves — a stream abandoned without cancelling
 * holds the connection open until the server gives up on it.
 */
export async function readSseStream(
  response: Response,
  onFrame: (frame: SseFrame) => void,
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const parser = createSseParser(onFrame);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.feed(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
