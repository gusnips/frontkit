import { useId, useState } from "react";

export interface SlashCommand {
  /** One token, without the leading slash. */
  name: string;
  description: string;
  /** Other executable names. Tags only help search. */
  aliases: readonly string[];
  tags: readonly string[];
  takesArg?: boolean;
}

export interface ParsedCommand {
  name: string;
  /** Undefined before a space; empty after a space with no argument yet. */
  arg?: string;
}

/** Multiline text and a slash inside a message are not commands. */
export function parseCommand(text: string): ParsedCommand | null {
  if (/[\r\n\u{2028}\u{2029}]/u.test(text)) return null;
  const match = /^\s*\/(\S*)(?:[^\S\r\n]+(.*))?$/u.exec(text);
  if (!match) return null;
  const name = (match[1] ?? "").toLowerCase();
  return match[2] === undefined ? { name } : { name, arg: match[2] };
}

export type CommandResolution<T extends SlashCommand = SlashCommand> =
  | { kind: "matched"; command: T }
  | { kind: "unknown"; name: string }
  | { kind: "ambiguous"; name: string; commands: readonly T[] };

/** Exact names win over aliases. Search tags never execute an action. */
export function resolveCommand<T extends SlashCommand>(
  commands: readonly T[],
  name: string,
): CommandResolution<T> {
  const token = name.toLowerCase();
  if (!token) return { kind: "unknown", name };
  let matches = commands.filter((command) => command.name.toLowerCase() === token);
  if (matches.length === 0) {
    matches = commands.filter((command) =>
      command.aliases.some((alias) => alias.toLowerCase() === token),
    );
  }
  if (matches.length > 1) return { kind: "ambiguous", name, commands: matches };
  const command = matches[0];
  return command ? { kind: "matched", command } : { kind: "unknown", name };
}

function searchText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function rank(command: SlashCommand, query: string): number {
  if (!query) return 0;
  const name = searchText(command.name);
  const aliases = command.aliases.map(searchText);
  if (name === query) return 0;
  if (aliases.includes(query)) return 1;
  if (name.startsWith(query)) return 2;
  if (aliases.some((alias) => alias.startsWith(query))) return 3;
  if (command.tags.some((tag) => searchText(tag).includes(query))) return 4;
  if (searchText(command.description).includes(query)) return 5;
  return Infinity;
}

/** One row per name, in registry order when two results have the same rank. */
export function matchCommands<T extends SlashCommand>(commands: readonly T[], query: string): T[] {
  const token = searchText(query.trim());
  const names = new Set<string>();
  return commands
    .filter((command) => {
      const name = command.name.toLowerCase();
      if (names.has(name)) return false;
      names.add(name);
      return true;
    })
    .map((command) => ({ command, rank: rank(command, token) }))
    .filter((match) => Number.isFinite(match.rank))
    .sort((a, b) => a.rank - b.rank)
    .map((match) => match.command);
}

/** Replace only the name, keeping the argument already typed. */
export function completeCommand(command: SlashCommand, text: string): string {
  const arg = parseCommand(text)?.arg;
  if (arg !== undefined) return `/${command.name} ${arg}`;
  return `/${command.name}${command.takesArg ? " " : ""}`;
}

export type CommandProblem<T extends SlashCommand = SlashCommand> = Exclude<
  CommandResolution<T>,
  { kind: "matched" }
>;

export interface CommandOptions<T extends SlashCommand> {
  text: string;
  /** Supply only commands allowed here, with current translated descriptions and tags. */
  commands: readonly T[];
  onChange: (text: string) => void;
  /** The app owns authorization, errors, draft cleanup and attachments. */
  onExecute: (command: T, arg: string | undefined, altKey: boolean) => void;
  /** Required: show a way back to the available commands, never send this text to the model. */
  onError: (problem: CommandProblem<T>) => void;
}

/** Structural so React events and small test events both fit. */
export interface CommandKeyEvent {
  key: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
  preventDefault: () => void;
}

export interface SlashCommandMenu<T extends SlashCommand = SlashCommand> {
  parsed: ParsedCommand | null;
  open: boolean;
  items: readonly T[];
  index: number;
  active: T | undefined;
  listId: string;
  itemId: (command: T) => string;
  activeId: string | undefined;
  highlight: (index: number) => void;
  close: () => void;
  showAll: () => void;
  pick: (command: T, altKey?: boolean) => void;
  submit: (altKey?: boolean) => boolean;
  handleKeyDown: (event: CommandKeyEvent) => boolean;
}

/** A controlled textarea menu. No UI, browser globals, timers or attachment state. */
export function useSlashCommands<T extends SlashCommand>({
  text,
  commands,
  onChange,
  onExecute,
  onError,
}: CommandOptions<T>): SlashCommandMenu<T> {
  const parsed = parseCommand(text);
  const resolution = parsed ? resolveCommand(commands, parsed.name) : null;
  const editingName =
    parsed !== null && (parsed.arg === undefined || resolution?.kind !== "matched");
  const items = editingName ? matchCommands(commands, parsed.name) : [];
  const key = JSON.stringify([text, items.map((command) => command.name)]);
  const [state, setState] = useState({ key, text, index: 0, deliberate: false, dismissed: false });
  // Reset selection on a changed result set, but keep Escape's dismissal until the draft changes.
  if (state.key !== key) {
    setState({
      key,
      text,
      index: 0,
      deliberate: false,
      dismissed: state.text === text && state.dismissed,
    });
  }

  const listId = `${useId()}-commands`;
  const open = editingName && !state.dismissed;
  const active = open ? items[state.index] : undefined;
  const itemId = (command: T) => `${listId}-${encodeURIComponent(command.name)}`;

  function close(): void {
    setState((current) => ({ ...current, dismissed: true }));
  }

  function showAll(): void {
    setState((current) => ({ ...current, index: 0, deliberate: false, dismissed: false }));
    onChange("/");
  }

  function highlight(index: number): void {
    if (!items[index]) return;
    setState((current) => ({ ...current, index, deliberate: true }));
  }

  function pick(command: T, altKey = false): void {
    // Re-resolve against current capabilities, not a descriptor retained by a caller.
    const selected = resolveCommand(commands, command.name);
    if (selected.kind !== "matched") {
      onError(selected);
      return;
    }
    if (selected.command.takesArg || parsed?.arg) {
      onChange(completeCommand(selected.command, text));
      return;
    }
    onExecute(selected.command, parsed?.arg, altKey);
  }

  /** Call before the normal send/queue/quota path, including button and imperative submits. */
  function submit(altKey = false): boolean {
    if (!parsed || !resolution) return false;
    if (resolution.kind !== "matched") {
      onError(resolution);
      return true;
    }
    if (
      resolution.command.takesArg &&
      parsed.arg === undefined &&
      parsed.name !== resolution.command.name.toLowerCase()
    ) {
      onChange(completeCommand(resolution.command, text));
      return true;
    }
    onExecute(resolution.command, parsed.arg, altKey);
    return true;
  }

  /** Call first. True means skip your own key handler; IME still gets the browser's default. */
  function handleKeyDown(event: CommandKeyEvent): boolean {
    const native = event.nativeEvent ?? event;
    if (native.isComposing || native.keyCode === 229) return true;
    if (event.shiftKey) return false;
    if (open && event.key === "Escape") {
      event.preventDefault();
      close();
      return true;
    }
    if (open && items.length > 0 && !event.ctrlKey && !event.metaKey) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        highlight((state.index + step + items.length) % items.length);
        return true;
      }
      if (active && (event.key === "Enter" || event.key === "Tab")) {
        event.preventDefault();
        if (event.key === "Tab") {
          onChange(completeCommand(active, text));
        } else if (resolution?.kind === "ambiguous" && !state.deliberate) {
          onError(resolution);
        } else {
          pick(active, event.altKey);
        }
        return true;
      }
    }
    if (parsed && event.key === "Enter") {
      event.preventDefault();
      return submit(event.altKey);
    }
    return false;
  }

  return {
    parsed,
    open,
    items,
    index: state.index,
    active,
    listId,
    itemId,
    activeId: active ? itemId(active) : undefined,
    highlight,
    close,
    showAll,
    pick,
    submit,
    handleKeyDown,
  };
}
