// Claude chat bridge: drives one Claude Code session through the Claude Agent
// SDK and speaks newline-delimited JSON with the Terax host over stdio.
//
// host -> bridge (stdin, one JSON object per line)
//   {op:"start", cwd, resume?, model?, permissionMode?, claudePath?}
//   {op:"send", text, attachments?: string[]}   absolute paths picked by the user
//   {op:"permission", id, allow, always?, message?}
//   {op:"interrupt"} | {op:"set_model", model} | {op:"set_mode", mode}
//   {op:"set_effort", effort}   low|medium|high|xhigh|max, "" = back to default
//   {op:"set_ultracode", on}    ultracode on/off (separate switch, not a level)
//   {op:"settings"}             report what the session actually runs with
//   {op:"models"} | {op:"usage"} | {op:"commands"}
// bridge -> host (stdout, one JSON object per line)
//   {type:"sdk", msg}                      every SDK message, untouched
//   {type:"permission_request", id, toolName, input, blockedPath, canAlways}
//   {type:"models", models:[{value, displayName, description}]}
//   {type:"usage", usage}                  plan rate-limit windows (/usage)
//   {type:"commands", commands:[{name, description, argumentHint, builtin?}]}
//   {type:"history", messages}             earlier turns of a resumed session
//   {type:"settings", model, effort, ultracode, ultracodeAvailable}
//                                          what the session actually runs with
//   {type:"error", message} | {type:"closed"}
// Diagnostics go to stderr only; stdout carries protocol lines exclusively.

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { createInterface } from "node:readline";
import { getSessionMessages, query } from "@anthropic-ai/claude-agent-sdk";

const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const log = (...a) => process.stderr.write(`[claude-bridge] ${a.join(" ")}\n`);

/** Prompt queue fed by `send`, consumed by the SDK as an async iterable. */
function createInbox() {
  const queue = [];
  let wake = null;
  let closed = false;
  return {
    push(content) {
      queue.push({
        type: "user",
        message: { role: "user", content },
        parent_tool_use_id: null,
        origin: { kind: "human" },
      });
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (queue.length) yield queue.shift();
        if (closed) return;
        await new Promise((r) => {
          wake = r;
        });
        wake = null;
      }
    },
  };
}

const IMAGE_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
/** Above this an image goes by path instead of inline (API image limit). */
const MAX_INLINE_IMAGE = 5 * 1024 * 1024;

/**
 * Images go inline so Claude sees them directly; anything else is listed by
 * absolute path and Claude reads it with its own tools.
 */
async function withAttachments(text, files) {
  const blocks = [];
  const byPath = [];
  for (const file of files) {
    const mediaType = IMAGE_TYPES[extname(file).toLowerCase()];
    if (mediaType) {
      try {
        const data = await readFile(file);
        if (data.length <= MAX_INLINE_IMAGE) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: mediaType, data: data.toString("base64") },
          });
          continue;
        }
      } catch (e) {
        log("attachment unreadable", file, String(e));
      }
    }
    byPath.push(file);
  }
  let body = text.trim();
  if (byPath.length) {
    const list = byPath.map((f) => `- ${f}`).join("\n");
    body = `${body}\n\n附件(${byPath.length} 个文件,请按路径读取):\n${list}`.trim();
  }
  if (!body) body = blocks.length ? "请看附件" : "";
  const names = files.map((f) => basename(f)).join(", ");
  log("send with attachments:", names);
  return [...blocks, { type: "text", text: body }];
}

let session = null;
const inbox = createInbox();
/** Pending canUseTool decisions keyed by request id. */
const pending = new Map();
let nextId = 1;

async function start(cmd) {
  if (session) return;
  const options = {
    cwd: cmd.cwd,
    includePartialMessages: true,
    // Load the same settings, CLAUDE.md and skills the terminal session sees.
    settingSources: ["user", "project", "local"],
    systemPrompt: { type: "preset", preset: "claude_code" },
    canUseTool: (toolName, input, opts) =>
      new Promise((resolve) => {
        const id = String(nextId++);
        pending.set(id, { resolve, suggestions: opts.suggestions });
        opts.signal?.addEventListener("abort", () => {
          if (pending.delete(id)) {
            resolve({ behavior: "deny", message: "cancelled" });
          }
        });
        out({
          type: "permission_request",
          id,
          toolName,
          input,
          blockedPath: opts.blockedPath ?? null,
          canAlways: Array.isArray(opts.suggestions) && opts.suggestions.length > 0,
        });
      }),
    stderr: (line) => log(line.trimEnd()),
  };
  if (cmd.claudePath) options.pathToClaudeCodeExecutable = cmd.claudePath;
  if (cmd.resume) options.resume = cmd.resume;
  if (cmd.model) options.model = cmd.model;
  // Always allowed, so the chat can switch into "完全访问" later with
  // setPermissionMode; without it the CLI refuses bypass for the whole
  // session. The starting mode itself is whatever the user last picked.
  options.allowDangerouslySkipPermissions = true;
  if (cmd.permissionMode) options.permissionMode = cmd.permissionMode;

  session = query({ prompt: inbox, options });
  if (cmd.resume) {
    // Resuming doesn't replay old turns on the stream; read them from disk
    // so the chat shows where the conversation left off.
    getSessionMessages(cmd.resume, { dir: cmd.cwd })
      .then((messages) => out({ type: "history", messages }))
      .catch((e) => log("history unavailable", String(e)));
  }
  try {
    for await (const msg of session) out({ type: "sdk", msg });
  } catch (e) {
    out({ type: "error", message: String(e?.message ?? e) });
  } finally {
    out({ type: "closed" });
    process.exit(0);
  }
}

/**
 * 会话实际用的强度 / ultracode(get_settings 的 applied):不指定时各模型
 * 默认档不一样(Opus 5.5 是 medium),界面要显示真实值而不是猜。
 * getSettings 没写进类型声明,但 Query 上有。
 */
async function reportSettings() {
  try {
    const a = (await session?.getSettings?.())?.applied;
    if (!a) return;
    out({
      type: "settings",
      model: a.model ?? null,
      effort: a.effort ?? null,
      ultracode: a.ultracode === true,
      ultracodeAvailable: a.ultracodeAvailable !== false,
    });
  } catch (e) {
    log("settings unavailable", String(e?.message ?? e));
  }
}

async function handle(cmd) {
  switch (cmd.op) {
    case "start":
      void start(cmd);
      return;
    case "send": {
      const text = typeof cmd.text === "string" ? cmd.text : "";
      const files = Array.isArray(cmd.attachments) ? cmd.attachments : [];
      if (!text.trim() && files.length === 0) return;
      inbox.push(files.length ? await withAttachments(text, files) : text);
      return;
    }
    case "permission": {
      const p = pending.get(String(cmd.id));
      if (!p) return;
      pending.delete(String(cmd.id));
      if (cmd.allow) {
        p.resolve({
          behavior: "allow",
          // AskUserQuestion 的回答放在 updatedInput.answers 里带回去
          ...(cmd.updatedInput && typeof cmd.updatedInput === "object"
            ? { updatedInput: cmd.updatedInput }
            : {}),
          ...(cmd.always && p.suggestions
            ? { updatedPermissions: p.suggestions }
            : {}),
        });
      } else {
        p.resolve({
          behavior: "deny",
          message: cmd.message || "用户拒绝了这次操作",
        });
      }
      return;
    }
    case "interrupt":
      await session?.interrupt();
      return;
    case "set_model":
      await session?.setModel(cmd.model || undefined);
      // 换模型默认强度也跟着变
      void reportSettings();
      return;
    case "set_mode":
      await session?.setPermissionMode(cmd.mode);
      return;
    case "set_effort":
      // 只改这个会话(flag 层),不写进 settings.json;null 回到模型默认
      try {
        await session?.applyFlagSettings({ effortLevel: cmd.effort || null });
      } catch (e) {
        // 不走 error:那会把正在进行的一轮标成结束
        log("set_effort failed", String(e?.message ?? e));
      }
      void reportSettings();
      return;
    case "set_ultracode":
      // 和强度是两回事:单独的开关,开了按 xhigh 跑并带多代理工作流编排;
      // null = 关掉,强度保持原样
      try {
        await session?.applyFlagSettings({ ultracode: cmd.on ? true : null });
      } catch (e) {
        log("set_ultracode failed", String(e?.message ?? e));
      }
      void reportSettings();
      return;
    case "settings":
      await reportSettings();
      return;
    case "models": {
      // 打开模型菜单时来要;顺便报一次实际强度
      void reportSettings();
      const models = (await session?.supportedModels()) ?? [];
      out({
        type: "models",
        models: models.map((m) => ({
          value: m.value,
          displayName: m.displayName,
          description: m.description ?? "",
          efforts: m.supportsEffort ? (m.supportedEffortLevels ?? []) : [],
        })),
      });
      return;
    }
    case "commands": {
      // 技能和斜杠命令(带说明),输入框里打 / 选;之后有变化走 commands_changed
      let commands = [];
      try {
        commands = (await session?.supportedCommands()) ?? [];
      } catch (e) {
        log("commands unavailable", String(e));
      }
      out({ type: "commands", commands });
      return;
    }
    case "usage": {
      // /usage 背后的数据;SDK 标着实验接口,拿不到就回 null,界面说读不到
      let usage = null;
      try {
        const u =
          await session?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(
            { skipBehaviors: true },
          );
        if (u) {
          usage = {
            subscriptionType: u.subscription_type ?? null,
            available: u.rate_limits_available === true,
            rateLimits: u.rate_limits ?? null,
          };
        }
      } catch (e) {
        log("usage unavailable", String(e));
      }
      out({ type: "usage", usage });
      return;
    }
    default:
      log("unknown op", cmd.op);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch {
    log("bad line", line.slice(0, 200));
    return;
  }
  handle(cmd).catch((e) => out({ type: "error", message: String(e?.message ?? e) }));
});
rl.on("close", () => {
  // Host went away: stop feeding the SDK so the session winds down.
  inbox.close();
  session?.interrupt().catch(() => {});
  setTimeout(() => process.exit(0), 2000).unref();
});
