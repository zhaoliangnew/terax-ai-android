/**
 * Claude 的 Workflow 工具(多代理编排)在聊天里的进度。SDK 只把整个 workflow
 * 当成一个后台任务报(总用量、用时),看不到分阶段、各代理的情况;那些在
 * 运行目录的 journal.jsonl 里,/workflows 面板读的就是它。这里把脚本里的
 * meta 和 journal 解析成界面要的样子。
 */

export type WorkflowMeta = {
  name: string;
  description: string;
  /** meta.phases 里的标题,按脚本里的顺序。 */
  phases: string[];
};

/** stopped:workflow 已经结束(被停/失败/翻旧会话),它还没跑完。 */
export type WorkflowAgentStatus = "running" | "done" | "failed" | "stopped";

export type WorkflowAgentState = {
  /** journal 里的 key(同一个 agent() 调用重跑时 key 不变,agentId 会变)。 */
  id: string;
  label: string;
  phase: string;
  status: WorkflowAgentStatus;
};

export type WorkflowJournal = {
  agents: WorkflowAgentState[];
  /** journal 里出现过、但 meta 没声明的阶段,按出现顺序。 */
  phasesSeen: string[];
};

const STRING = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/;

function unescapeQuoted(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

/**
 * 从脚本文本里抠 meta(纯字面量,按约定写在开头);抠不出就给空。
 * 只在 meta 那一段里找,免得抠到正文里同名的字段。
 */
export function parseWorkflowMeta(script: string): WorkflowMeta {
  const metaStart = script.search(/export\s+const\s+meta\s*=/);
  const head = metaStart >= 0 ? script.slice(metaStart) : script;
  // meta 对象到第一个顶格的 "}" 为止
  const metaEnd = head.search(/\n\}/);
  const metaText = metaEnd >= 0 ? head.slice(0, metaEnd + 2) : head;
  const field = (key: string) => {
    const m = new RegExp(`\\b${key}\\s*:\\s*${STRING.source}`).exec(metaText);
    return m ? unescapeQuoted(m[2]) : "";
  };
  // phases:从 "phases:" 往后到 meta 结束,收集所有 title 字符串(标题、detail
  // 里带 "]" 也不会截断)
  const at = metaText.search(/\bphases\s*:/);
  const phases =
    at >= 0
      ? [
          ...metaText
            .slice(at)
            .matchAll(new RegExp(`\\btitle\\s*:\\s*${STRING.source}`, "g")),
        ].map((m) => unescapeQuoted(m[2]))
      : [];
  return { name: field("name"), description: field("description"), phases };
}

/** 工具结果里的运行目录("Transcript dir: …")。 */
export function workflowRunDir(resultText: string): string | null {
  const m = /Transcript dir:\s*(.+?)\s*$/m.exec(resultText);
  return m ? m[1] : null;
}

/** 工具结果里的脚本文件("Script file: …"):按名字跑的 workflow 靠它拿 meta。 */
export function workflowScriptFile(resultText: string): string | null {
  const m = /Script file:\s*(.+?)\s*$/m.exec(resultText);
  return m ? m[1] : null;
}

/**
 * journal.jsonl 一行一个事件:started(开跑)、result(跑完)、failed(跳过/
 * 出错/重试后还是挂了)。按 key 归并:resume 时同一个 agent() 会用新的
 * agentId 再 started 一次,不能当成两个代理。
 */
export function parseWorkflowJournal(text: string): WorkflowJournal {
  const byKey = new Map<string, WorkflowAgentState>();
  const keyOfAgent = new Map<string, string>();
  const phasesSeen: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e: {
      type?: string;
      key?: string;
      agentId?: string;
      label?: string;
      phase?: string;
      result?: unknown;
    };
    try {
      e = JSON.parse(line);
    } catch {
      // 正在写的最后一行可能不完整
      continue;
    }
    const key = e.key || (e.agentId ? keyOfAgent.get(e.agentId) : undefined);
    if (e.type === "started") {
      const id = e.key || e.agentId;
      if (!id) continue;
      if (e.agentId) keyOfAgent.set(e.agentId, id);
      const phase = e.phase ?? "";
      if (phase && !phasesSeen.includes(phase)) phasesSeen.push(phase);
      byKey.set(id, {
        id,
        label: e.label ?? id,
        phase,
        status: "running",
      });
    } else if (e.type === "result" || e.type === "failed") {
      const a = key ? byKey.get(key) : undefined;
      if (!a) continue;
      a.status = e.type === "failed" || e.result == null ? "failed" : "done";
    }
  }
  return { agents: [...byKey.values()], phasesSeen };
}

/** workflow 已经结束:还标着在跑的代理其实没跑完,改成 stopped。 */
export function settleJournal(
  journal: WorkflowJournal,
  finished: boolean,
): WorkflowJournal {
  if (!finished || !journal.agents.some((a) => a.status === "running"))
    return journal;
  return {
    ...journal,
    agents: journal.agents.map((a) =>
      a.status === "running" ? { ...a, status: "stopped" } : a,
    ),
  };
}

export type WorkflowPhaseView = {
  title: string;
  done: number;
  /** 没跑成的 + 没跑完就结束的。 */
  failed: number;
  total: number;
  state: "pending" | "running" | "done";
};

/** 阶段列表:meta 声明的在前(没开始的也列出来),journal 里多出来的接在后面。 */
export function workflowPhases(
  meta: WorkflowMeta,
  journal: WorkflowJournal,
): WorkflowPhaseView[] {
  const titles = [
    ...meta.phases,
    ...journal.phasesSeen.filter((p) => !meta.phases.includes(p)),
  ];
  // 没有阶段的代理(脚本没调 phase())归到一个无名组
  if (journal.agents.some((a) => !a.phase)) titles.push("");
  return titles.map((title) => {
    const list = journal.agents.filter((a) => a.phase === title);
    const done = list.filter((a) => a.status === "done").length;
    const failed = list.filter(
      (a) => a.status === "failed" || a.status === "stopped",
    ).length;
    const running = list.length - done - failed;
    return {
      title,
      done,
      failed,
      total: list.length,
      state: list.length === 0 ? "pending" : running > 0 ? "running" : "done",
    };
  });
}
