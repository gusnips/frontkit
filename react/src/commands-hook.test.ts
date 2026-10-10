// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect, type ChangeEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSlashCommands, type SlashCommand } from "./commands.ts";

interface Action extends SlashCommand {
  action: string;
}

const commands: readonly Action[] = [
  {
    name: "help",
    description: "See commands",
    aliases: ["commands"],
    tags: ["keyboard"],
    action: "help",
  },
  {
    name: "new",
    description: "Start a chat",
    aliases: ["fresh"],
    tags: ["conversation"],
    action: "new",
  },
  {
    name: "stop",
    description: "Stop the reply",
    aliases: ["cancel"],
    tags: ["reply"],
    action: "stop",
  },
  {
    name: "model",
    description: "Choose a model",
    aliases: ["llm"],
    tags: ["engine"],
    takesArg: true,
    action: "model",
  },
];

const roots = new Set<Root>();
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.clear();
  document.body.replaceChildren();
});

function composer(initialText = "/", initialCommands = commands) {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  roots.add(root);
  let text = initialText;
  let registry = initialCommands;
  let current: ReturnType<typeof useSlashCommands<Action>> | undefined;
  const execute = vi.fn();
  const error = vi.fn();
  const send = vi.fn();
  const changed = vi.fn((next: string) => {
    text = next;
    render();
  });

  function Harness() {
    const slash = useSlashCommands({
      text,
      commands: registry,
      onChange: changed,
      onExecute: execute,
      onError: error,
    });
    useLayoutEffect(() => {
      current = slash;
    }, [slash]);
    return createElement(
      "div",
      null,
      createElement("textarea", {
        value: text,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => changed(event.currentTarget.value),
        "aria-label": "Message",
        role: "combobox",
        "aria-autocomplete": "list",
        "aria-expanded": slash.open,
        "aria-controls": slash.open ? slash.listId : undefined,
        "aria-activedescendant": slash.activeId,
        onKeyDown: (event) => {
          if (slash.handleKeyDown(event)) return;
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send(text);
          }
        },
      }),
      createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            if (!slash.submit()) send(text);
          },
        },
        "Send",
      ),
      slash.open
        ? createElement(
            "div",
            { id: slash.listId, role: "listbox", "aria-label": "Commands" },
            ...slash.items.map((command, index) =>
              createElement(
                "button",
                {
                  key: command.name,
                  type: "button",
                  tabIndex: -1,
                  id: slash.itemId(command),
                  role: "option",
                  "aria-selected": slash.index === index,
                  onMouseEnter: () => slash.highlight(index),
                  onMouseDown: (event) => event.preventDefault(),
                  onClick: (event) => slash.pick(command, event.altKey),
                },
                `/${command.name}`,
              ),
            ),
          )
        : null,
    );
  }

  function render() {
    root.render(createElement(Harness));
  }
  act(render);
  const input = element.querySelector("textarea");
  const sendButton = element.querySelector("button");
  if (!input || !sendButton) throw new Error("Composer did not render");
  input.focus();

  return {
    execute,
    error,
    send,
    changed,
    input,
    get text() {
      return text;
    },
    get menu() {
      if (!current) throw new Error("Hook did not render");
      return current;
    },
    change(next: string) {
      act(() => {
        text = next;
        render();
      });
    },
    register(next: readonly Action[]) {
      act(() => {
        registry = next;
        render();
      });
    },
    press(key: string, options: KeyboardEventInit = {}) {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
      });
      act(() => input.dispatchEvent(event));
      return event;
    },
    clickSend() {
      act(() => sendButton.click());
    },
    clickOption(name: string, options: MouseEventInit = {}) {
      const option = Array.from(element.querySelectorAll("button[role=option]")).find(
        (button) => button.textContent === `/${name}`,
      );
      if (!option) throw new Error(`Command not rendered: ${name}`);
      const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      act(() => {
        option.dispatchEvent(down);
        option.dispatchEvent(new MouseEvent("click", { bubbles: true, ...options }));
      });
      return down;
    },
  };
}

describe("useSlashCommands", () => {
  it("wraps arrow selection and links the active row to the input", () => {
    const chat = composer();
    expect(chat.menu.index).toBe(0);
    expect(chat.input.getAttribute("aria-activedescendant")).toBe(chat.menu.itemId(commands[0]!));
    expect(chat.press("ArrowUp").defaultPrevented).toBe(true);
    expect(chat.menu.index).toBe(3);
    chat.press("ArrowDown");
    expect(chat.menu.index).toBe(0);
    expect(chat.input.getAttribute("aria-controls")).toBe(chat.menu.listId);
  });

  it("executes a selected local action once without sending or clearing the draft", () => {
    const chat = composer();
    chat.press("ArrowDown");
    chat.press("Enter");
    expect(chat.execute).toHaveBeenCalledExactlyOnceWith(commands[1], undefined, false);
    expect(chat.send).not.toHaveBeenCalled();
    expect(chat.changed).not.toHaveBeenCalled();
    expect(chat.text).toBe("/");
  });

  it("Tab completes a name without running its action", () => {
    const chat = composer("/he");
    expect(chat.press("Tab").defaultPrevented).toBe(true);
    expect(chat.text).toBe("/help");
    expect(chat.execute).not.toHaveBeenCalled();
  });

  it("retains arguments when keyboard selection completes a partial name", () => {
    const chat = composer("/mo large  model");
    chat.press("Enter");
    expect(chat.text).toBe("/model large  model");
    expect(chat.execute).not.toHaveBeenCalled();
    chat.press("Enter", { altKey: true });
    expect(chat.execute).toHaveBeenCalledExactlyOnceWith(commands[3], "large  model", true);
  });

  it("completes an argument-taking alias before keyboard or button submission", () => {
    const keyboard = composer("/llm");
    keyboard.press("Enter");
    expect(keyboard.text).toBe("/model ");
    expect(keyboard.execute).not.toHaveBeenCalled();
    const button = composer("/llm");
    button.clickSend();
    expect(button.text).toBe("/model ");
    expect(button.execute).not.toHaveBeenCalled();
  });

  it("button submission uses an exact alias without entering the message path", () => {
    const chat = composer("/cancel");
    chat.clickSend();
    expect(chat.execute).toHaveBeenCalledExactlyOnceWith(commands[2], undefined, false);
    expect(chat.send).not.toHaveBeenCalled();
  });

  it("Escape stays closed until the query changes", () => {
    const chat = composer("/he");
    expect(chat.press("Escape").defaultPrevented).toBe(true);
    expect(chat.menu.open).toBe(false);
    chat.register([commands[1]!]);
    expect(chat.menu.open).toBe(false);
    expect(chat.menu.activeId).toBeUndefined();
    chat.register(commands);
    chat.change("/hel");
    expect(chat.menu.open).toBe(true);
    expect(chat.menu.index).toBe(0);
    chat.change("/he");
    expect(chat.menu.open).toBe(true);
  });

  it("reopens the full list even when Escape dismissed the same bare slash", () => {
    const chat = composer();
    chat.press("ArrowDown");
    chat.press("Escape");
    expect(chat.menu.open).toBe(false);
    act(() => chat.menu.showAll());
    expect(chat.menu.open).toBe(true);
    expect(chat.menu.index).toBe(0);
    expect(chat.menu.items).toEqual(commands);
    expect(chat.text).toBe("/");
    expect(chat.execute).not.toHaveBeenCalled();
    expect(chat.send).not.toHaveBeenCalled();
  });

  it("returns an unknown draft to the full list for retry", () => {
    const chat = composer("/missing arg");
    chat.clickSend();
    act(() => chat.menu.showAll());
    expect(chat.text).toBe("/");
    expect(chat.menu.open).toBe(true);
    expect(chat.menu.items).toEqual(commands);
    expect(chat.execute).not.toHaveBeenCalled();
  });

  it("protects IME when given a native keyboard event directly", () => {
    const chat = composer("/help");
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      cancelable: true,
    });
    act(() => expect(chat.menu.handleKeyDown(event)).toBe(true));
    expect(event.defaultPrevented).toBe(false);
    expect(chat.execute).not.toHaveBeenCalled();
  });

  it("leaves Shift+Enter and modified arrow/Tab keys to the text field", () => {
    const chat = composer();
    for (const [key, options] of [
      ["Enter", { shiftKey: true }],
      ["ArrowDown", { shiftKey: true }],
      ["ArrowUp", { metaKey: true }],
      ["Tab", { shiftKey: true }],
    ] satisfies Array<[string, KeyboardEventInit]>) {
      expect(chat.press(key, options).defaultPrevented).toBe(false);
    }
    expect(chat.execute).not.toHaveBeenCalled();
    expect(chat.send).not.toHaveBeenCalled();
  });

  it("lets IME accept text without executing a command or sending a message", () => {
    const chat = composer("/help");
    expect(chat.press("Enter", { isComposing: true }).defaultPrevented).toBe(false);
    expect(chat.execute).not.toHaveBeenCalled();
    expect(chat.send).not.toHaveBeenCalled();
    chat.change("plain text");
    chat.press("Enter", { isComposing: true });
    expect(chat.send).not.toHaveBeenCalled();
  });

  it("also protects the final IME key reported only as keyCode 229", () => {
    const chat = composer("/help");
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    Object.defineProperty(event, "keyCode", { value: 229 });
    act(() => chat.input.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(chat.execute).not.toHaveBeenCalled();
    expect(chat.send).not.toHaveBeenCalled();
  });

  it("exposes empty results and reports unknown commands without sending them", () => {
    const chat = composer("/missing");
    expect(chat.menu.open).toBe(true);
    expect(chat.menu.items).toEqual([]);
    expect(chat.menu.activeId).toBeUndefined();
    chat.press("Enter");
    expect(chat.error).toHaveBeenCalledExactlyOnceWith({ kind: "unknown", name: "missing" });
    expect(chat.send).not.toHaveBeenCalled();
    expect(chat.text).toBe("/missing");
  });

  it("tags find a row but cannot execute through direct submission", () => {
    const chat = composer("/conversation");
    expect(chat.menu.items.map((command) => command.name)).toEqual(["new"]);
    chat.clickSend();
    expect(chat.error).toHaveBeenCalledWith({ kind: "unknown", name: "conversation" });
    expect(chat.execute).not.toHaveBeenCalled();
    chat.press("Tab");
    expect(chat.text).toBe("/new");
    chat.clickSend();
    expect(chat.execute).toHaveBeenCalledExactlyOnceWith(commands[1], undefined, false);
  });

  it("does not auto-dispatch an ambiguous alias on Enter or button submission", () => {
    const registry = commands.slice(0, 2).map((command) => ({ ...command, aliases: ["shared"] }));
    const chat = composer("/shared", registry);
    chat.press("Enter");
    chat.clickSend();
    expect(chat.error).toHaveBeenCalledTimes(2);
    expect(chat.error).toHaveBeenLastCalledWith({
      kind: "ambiguous",
      name: "shared",
      commands: registry,
    });
    expect(chat.execute).not.toHaveBeenCalled();
    expect(chat.send).not.toHaveBeenCalled();
  });

  it("lets an explicit arrow selection choose between ambiguous aliases", () => {
    const registry = commands.slice(0, 2).map((command) => ({ ...command, aliases: ["shared"] }));
    const chat = composer("/shared", registry);
    chat.press("ArrowDown");
    chat.press("Enter");
    expect(chat.execute).toHaveBeenCalledExactlyOnceWith(registry[1], undefined, false);
    expect(chat.error).not.toHaveBeenCalled();
  });

  it("keeps focus on the text field when a row is clicked", () => {
    const chat = composer();
    expect(chat.clickOption("stop", { altKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(chat.input);
    expect(chat.execute).toHaveBeenCalledExactlyOnceWith(commands[2], undefined, true);
    expect(chat.send).not.toHaveBeenCalled();
  });

  it("refreshes matching and resets selection when capabilities change under a fixed draft", () => {
    const chat = composer();
    chat.press("ArrowDown");
    expect(chat.menu.active?.name).toBe("new");
    chat.register([commands[2]!]);
    expect(chat.text).toBe("/");
    expect(chat.menu.index).toBe(0);
    expect(chat.menu.active?.name).toBe("stop");
    chat.press("Enter");
    expect(chat.execute).toHaveBeenCalledExactlyOnceWith(commands[2], undefined, false);
  });

  it("uses current translated search words even when the draft has not changed", () => {
    const chat = composer("/comecar");
    expect(chat.menu.items).toEqual([]);
    const translated = commands.map((command) =>
      command.name === "new"
        ? { ...command, description: "Comece uma conversa", tags: ["começar", "conversa"] }
        : command,
    );
    chat.register(translated);
    expect(chat.menu.items.map((command) => command.name)).toEqual(["new"]);
    expect(chat.text).toBe("/comecar");
  });

  it("re-resolves a retained row against current capabilities", () => {
    const chat = composer();
    const oldRow = chat.menu.items[2]!;
    chat.register(commands.slice(0, 2));
    act(() => chat.menu.pick(oldRow));
    expect(chat.error).toHaveBeenCalledWith({ kind: "unknown", name: "stop" });
    expect(chat.execute).not.toHaveBeenCalled();
  });

  it("direct submission does not depend on menu state and forwards Alt", () => {
    const chat = composer("/cancel");
    chat.press("Escape");
    act(() => expect(chat.menu.submit(true)).toBe(true));
    expect(chat.execute).toHaveBeenCalledExactlyOnceWith(commands[2], undefined, true);
  });

  it("leaves ordinary and multiline messages to the existing sender", () => {
    const chat = composer("hi");
    expect(chat.menu.open).toBe(false);
    chat.clickSend();
    expect(chat.send).toHaveBeenLastCalledWith("hi");
    chat.change("/help\nquoted text");
    chat.clickSend();
    expect(chat.send).toHaveBeenLastCalledWith("/help\nquoted text");
    expect(chat.execute).not.toHaveBeenCalled();
  });
});
