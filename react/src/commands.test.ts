// @vitest-environment node
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  completeCommand,
  matchCommands,
  parseCommand,
  resolveCommand,
  useSlashCommands,
} from "./commands.ts";

const help = {
  name: "help",
  description: "Show available commands",
  aliases: ["assist", "GUIDE"],
  tags: ["manual"],
};
const schedule = {
  name: "schedule",
  description: "Run a task later",
  aliases: ["later", "book"],
  tags: ["timer"],
  takesArg: true,
};
const commands = [help, schedule];

describe("parseCommand", () => {
  it.each([
    { text: "/", expected: { name: "" } },
    { text: "/ ", expected: { name: "", arg: "" } },
    { text: "/HELP", expected: { name: "help" } },
    { text: "/help ", expected: { name: "help", arg: "" } },
    { text: " \t/HeLp", expected: { name: "help" } },
    {
      text: "/SCHEDULE   Keep  these spaces\tand case  ",
      expected: { name: "schedule", arg: "Keep  these spaces\tand case  " },
    },
  ])("parses a single line: $text", ({ text, expected }) => {
    expect(parseCommand(text)).toEqual(expected);
  });

  it.each(["/tmp/file", "/help/topic", "//help"])(
    "keeps a slash path as an unknown command token: %s",
    (text) => {
      const name = text.slice(1);
      expect(parseCommand(text)).toEqual({ name });
      expect(resolveCommand(commands, name)).toEqual({ kind: "unknown", name });
    },
  );

  it.each(["", " \t", "help", "Please /help", "https://example.test/help", "Hello /help there"])(
    "ignores non-command prose: %s",
    (text) => {
      expect(parseCommand(text)).toBeNull();
    },
  );

  it.each(["\n", "\r", "\r\n", "\u{2028}", "\u{2029}"])(
    "rejects a line terminator anywhere: %j",
    (separator) => {
      for (const text of [`${separator}/help`, `/help${separator}`, `/help ${separator}topic`]) {
        expect(parseCommand(text)).toBeNull();
      }
    },
  );
});

describe("resolveCommand", () => {
  it("prefers an exact canonical name over an earlier alias", () => {
    const alias = { ...schedule, aliases: ["help"] };
    expect(resolveCommand([alias, help], "HELP")).toEqual({ kind: "matched", command: help });
  });

  it.each([
    { token: "guide", command: help },
    { token: "LATER", command: schedule },
  ])("matches an alias without case sensitivity: $token", ({ token, command }) => {
    expect(resolveCommand(commands, token)).toEqual({ kind: "matched", command });
  });

  it("reports aliases shared by different commands in registry order", () => {
    const first = { ...schedule, aliases: ["shared", "SHARED"] };
    const second = { ...help, aliases: ["shared"] };
    expect(resolveCommand([first, second], "SHARED")).toEqual({
      kind: "ambiguous",
      name: "SHARED",
      commands: [first, second],
    });
    expect(resolveCommand([first], "shared")).toEqual({ kind: "matched", command: first });
  });

  it("reports duplicate canonical names even when an alias also matches", () => {
    const duplicate = { ...schedule, name: "HELP" };
    const alias = { ...schedule, aliases: ["help"] };
    expect(resolveCommand([help, alias, duplicate], "help")).toEqual({
      kind: "ambiguous",
      name: "help",
      commands: [help, duplicate],
    });
  });

  it.each(["manual", "timer", "Show available commands", "hel", "lat", "missing"])(
    "does not execute a tag, description, prefix or unknown token: %s",
    (name) => {
      expect(resolveCommand(commands, name)).toEqual({ kind: "unknown", name });
    },
  );

  it("never executes an empty token, even if the registry contains one", () => {
    expect(resolveCommand([{ ...help, name: "", aliases: [""] }], "")).toEqual({
      kind: "unknown",
      name: "",
    });
  });
});

describe("matchCommands", () => {
  it("ranks names, aliases, prefixes, tags and descriptions with stable ties", () => {
    const registry = [
      { name: "description", description: "Find a task", aliases: [], tags: [] },
      { name: "tag", description: "", aliases: [], tags: ["finder"] },
      { name: "shortcut", description: "", aliases: ["finder"], tags: [] },
      { name: "finding", description: "", aliases: [], tags: [] },
      { name: "alias", description: "", aliases: ["find"], tags: [] },
      { name: "find", description: "", aliases: [], tags: [] },
      { name: "second-tag", description: "", aliases: [], tags: ["find"] },
      { name: "second-description", description: "Find another task", aliases: [], tags: [] },
      { name: "unrelated", description: "", aliases: [], tags: [] },
    ];
    expect(matchCommands(registry, "find").map((command) => command.name)).toEqual([
      "find",
      "alias",
      "finding",
      "shortcut",
      "tag",
      "second-tag",
      "description",
      "second-description",
    ]);
  });

  const translated = [
    {
      name: "ação",
      description: "A próxima revisão",
      aliases: ["café"],
      tags: ["rápido"],
    },
    {
      name: "mañana",
      description: "Resumen de la reunión",
      aliases: ["después"],
      tags: ["configuración"],
    },
  ];
  it.each([
    { query: " ACAO ", name: "ação" },
    { query: "ac\u{0327}a\u{0303}o", name: "ação" },
    { query: "CAFE", name: "ação" },
    { query: "RAPIDO", name: "ação" },
    { query: "PROXIMA REVISAO", name: "ação" },
    { query: "MANANA", name: "mañana" },
    { query: "DESPUES", name: "mañana" },
    { query: "CONFIGURACION", name: "mañana" },
    { query: "REUNION", name: "mañana" },
  ])("matches case and accents across search fields: $query", ({ query, name }) => {
    expect(matchCommands(translated, query).map((command) => command.name)).toEqual([name]);
  });

  it("returns only the first descriptor for each canonical name", () => {
    const duplicate = { ...help, name: "HELP" };
    const registry = [help, schedule, duplicate];
    expect(matchCommands(registry, "help")).toEqual([help]);
    expect(matchCommands(registry, "")).toEqual(commands);
  });

  it("does not turn repeated or shared aliases into duplicate rows", () => {
    const first = { ...help, aliases: ["shared", "shared", "SHARED"] };
    const second = { ...schedule, aliases: ["shared"] };
    expect(matchCommands([first, second], "shared")).toEqual([first, second]);
  });

  it("returns original descriptors and preserves their extra fields in the type", () => {
    const custom = { ...help, execute: () => "done" };
    const [matched] = matchCommands([custom], "assist");
    expectTypeOf(matched).toEqualTypeOf<typeof custom | undefined>();
    expect(matched).toBe(custom);
    expect(matched?.execute()).toBe("done");
  });

  it.each(["", " \t "])("keeps registry order for an empty query: %j", (query) => {
    expect(matchCommands([schedule, help], query)).toEqual([schedule, help]);
  });

  it("returns no rows for an unrelated query", () => {
    expect(matchCommands(commands, "missing")).toEqual([]);
  });
});

describe("completeCommand", () => {
  it.each([
    ["/later", "/schedule "],
    ["/sche", "/schedule "],
    ["/SCHEDULE", "/schedule "],
    ["/", "/schedule "],
    ["/later ", "/schedule "],
    [" \t/later Keep  these spaces\tand case  ", "/schedule Keep  these spaces\tand case  "],
  ])("canonicalizes an argument-taking command: %s", (text, expected) => {
    expect(completeCommand(schedule, text)).toBe(expected);
  });

  it.each([
    ["/assi", "/help"],
    ["/GUIDE", "/help"],
    ["/", "/help"],
    ["/assist topic  with spaces  ", "/help topic  with spaces  "],
  ])("canonicalizes a plain command without dropping its arguments: %s", (text, expected) => {
    expect(completeCommand(help, text)).toBe(expected);
  });
});

describe("useSlashCommands on the server", () => {
  it("imports and renders in Node without browser globals or running callbacks", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    const onChange = vi.fn();
    const onExecute = vi.fn();
    const onError = vi.fn();

    function Menu() {
      const menu = useSlashCommands({ text: "/he", commands, onChange, onExecute, onError });
      return createElement(
        "output",
        { id: menu.listId },
        `${menu.open}/${menu.active?.name}/${menu.items.length}`,
      );
    }

    expect(renderToString(createElement(Menu))).toContain("true/help/1");
    expect(onChange).not.toHaveBeenCalled();
    expect(onExecute).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
