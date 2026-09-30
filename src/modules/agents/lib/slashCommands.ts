/** 输入框里 / (Codex 是 $)弹出来的一项:技能或命令。 */
export type SlashCommandOption = {
  name: string;
  description: string;
  argumentHint: string;
  /** 工具自带的命令(compact、init…);false 的是技能、自定义命令。 */
  builtin: boolean;
  aliases?: string[];
  /** Codex 的技能要带上 SKILL.md 的路径一起发。 */
  path?: string;
};

type RawCommand = {
  name?: unknown;
  description?: unknown;
  argumentHint?: unknown;
  builtin?: unknown;
  aliases?: unknown;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** SDK 的 supportedCommands() / commands_changed 里的列表。 */
export function normalizeCommands(raw: unknown): SlashCommandOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SlashCommandOption[] = [];
  for (const c of raw as RawCommand[]) {
    const name = str(c?.name).replace(/^\//, "");
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      description: str(c.description),
      argumentHint: str(c.argumentHint),
      builtin: c.builtin === true,
      ...(Array.isArray(c.aliases)
        ? { aliases: c.aliases.filter((a) => typeof a === "string") }
        : {}),
    });
  }
  return out;
}

/**
 * init 消息里只有名字:slash_commands 是全部,skills 是其中的技能;
 * terminal_slash_commands 只在终端里有用,不列。
 */
export function commandsFromInit(msg: {
  slash_commands?: unknown;
  skills?: unknown;
  terminal_slash_commands?: unknown;
}): SlashCommandOption[] {
  const names = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const skills = new Set(names(msg.skills));
  const terminal = new Set(names(msg.terminal_slash_commands));
  const all = [...names(msg.slash_commands), ...skills];
  return normalizeCommands(
    all
      .filter((n) => !terminal.has(n))
      .map((name) => ({ name, builtin: !skills.has(name) })),
  );
}

/** Codex `skills/list` 的结果,只要启用着的。 */
export function commandsFromCodexSkills(res: unknown): SlashCommandOption[] {
  const data = (res as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const out: SlashCommandOption[] = [];
  for (const entry of data) {
    const skills = (entry as { skills?: unknown })?.skills;
    if (!Array.isArray(skills)) continue;
    for (const s of skills) {
      const name = str(s?.name);
      if (!name || s.enabled === false || seen.has(name)) continue;
      seen.add(name);
      out.push({
        name,
        description:
          str(s.interface?.shortDescription) ||
          str(s.shortDescription) ||
          str(s.description),
        argumentHint: "",
        builtin: false,
        path: str(s.path),
      });
    }
  }
  return out;
}

/**
 * 光标前正在输入的 /xxx(或 $xxx):返回触发符、关键字和它在文本里的起点。
 * `anywhere` 为 false 时只认整条消息开头的(Claude 的命令只能放开头)。
 */
export function commandQuery(
  beforeCaret: string,
  triggers: readonly string[],
  anywhere: boolean,
): { trigger: string; query: string; start: number } | null {
  const m = /(^|\s)(\S)(\S*)$/.exec(beforeCaret);
  if (!m || !triggers.includes(m[2])) return null;
  const start = m.index + m[1].length;
  if (!anywhere && beforeCaret.slice(0, start).trim() !== "") return null;
  return { trigger: m[2], query: m[3], start };
}

/** 按关键字筛:名字开头的排前面,其次名字/说明里包含的;技能排在内置命令前。 */
export function matchCommands(
  commands: readonly SlashCommandOption[],
  query: string,
): SlashCommandOption[] {
  const q = query.toLowerCase();
  const rank = (c: SlashCommandOption) => {
    const names = [c.name, ...(c.aliases ?? [])].map((n) => n.toLowerCase());
    if (!q) return 0;
    if (names.some((n) => n.startsWith(q))) return 0;
    if (names.some((n) => n.includes(q))) return 1;
    if (c.description.toLowerCase().includes(q)) return 2;
    return -1;
  };
  return commands
    .map((c, i) => ({ c, i, r: rank(c) }))
    .filter((x) => x.r >= 0)
    .sort(
      (a, b) =>
        a.r - b.r || Number(a.c.builtin) - Number(b.c.builtin) || a.i - b.i,
    )
    .map((x) => x.c);
}

/** 消息里用 $名字 点到的 Codex 技能(按出现顺序,不重复)。 */
export function mentionedSkills(
  text: string,
  skills: readonly SlashCommandOption[],
): SlashCommandOption[] {
  const byName = new Map(skills.filter((s) => s.path).map((s) => [s.name, s]));
  const out: SlashCommandOption[] = [];
  for (const m of text.matchAll(/(?:^|\s)\$([^\s$]+)/g)) {
    const s = byName.get(m[1]);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
