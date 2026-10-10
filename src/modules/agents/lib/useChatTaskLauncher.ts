import { native } from "@/modules/ai/lib/native";
import { setTaskLink } from "@/modules/android-run/lib/yunxiao";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import {
  AGENT_NAMES,
  chatSessionNow,
  subscribeChatSession,
} from "../store/chatProviders";
import type { ChatSession } from "../store/claudeChatStore";
import { pickChatAgent } from "./chatPrefs";
import {
  bindChatTaskHost,
  focusChatTask,
  launchChatInLeaf,
  liveChatTask,
  otherTaskOnDir,
  rememberChatTask,
  reopenChatTask,
  retryChatTask,
  START_CHAT_TASK,
  type StartChatTaskDetail,
} from "./startChatTask";

type Params = {
  booted: boolean;
  newAgentTab: (
    cwd: string | undefined,
    title: string,
  ) => { tabId: number; leafId: number };
  tabsRef: RefObject<Tab[]>;
  activateAgentTarget: (tabId: number, leafId: number) => void;
  dirUsable: (path: string) => Promise<boolean>;
  bumpLinks: () => void;
};

/** 盯启动结果的时长:起来了或过了这么久就不管了。 */
const WATCH_MS = 60_000;

/** 正在开的任务(要等目录检查、授权):这期间再点一次不能开第二个。 */
const launching = new Set<string>();

function baseName(dir: string): string {
  return dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
}

/** 会话起来了就收手;没起来(出错、进程退出)弹 toast,带"重试"。 */
function watchStart(d: StartChatTaskDetail, leafId: number, dir: string) {
  let done = false;
  let off = () => {};
  const stop = () => {
    done = true;
    clearTimeout(timer);
    off();
  };
  const timer = setTimeout(stop, WATCH_MS);
  const check = (s: ChatSession | undefined) => {
    // 会话被换掉(点了新对话、重试)时中间会短暂没有,不算失败
    if (done || !s) return;
    if (s.status === "ready" || s.sessionId) {
      stop();
      return;
    }
    if (s.status !== "error" && s.status !== "closed") return;
    stop();
    // tab 已经关了(App 收窗格时会停掉它的聊天进程),会话结束是正常的
    if (liveChatTask(d.key)?.leafId !== leafId) return;
    toast.error(`${AGENT_NAMES[d.agent]} 没启动起来,任务还没开工`, {
      description: s.error ?? "会话还没起来就退出了",
      duration: 20_000,
      action: { label: "重试", onClick: () => retry(d, leafId, dir) },
    });
  };
  off = subscribeChatSession(d.agent, leafId, check);
  check(chatSessionNow(d.agent, leafId));
}

function retry(d: StartChatTaskDetail, leafId: number, dir: string) {
  if (liveChatTask(d.key)?.leafId !== leafId) {
    toast.info("这条任务的 tab 已经关了,到云效项目里再点一次开始开发");
    return;
  }
  retryChatTask(leafId, dir, d.agent, d.prompt);
  focusChatTask(d.key);
  watchStart(d, leafId, dir);
}

async function launch(req: StartChatTaskDetail, ref: RefObject<Params>) {
  const dir = req.dir.replace(/\/+$/, "") || req.dir;
  // 事件是从别的模块派过来的,AI 认不出就按这个目录平时的来
  const agent = req.agent in AGENT_NAMES ? req.agent : pickChatAgent(dir);
  const d: StartChatTaskDetail = { ...req, dir, agent };
  // 已经开着(包括重启后恢复出来的 tab)就切过去,不重发;当初没启动起来的顺手重来
  const reopened = reopenChatTask(d.key);
  if (reopened) {
    toast.info(
      reopened === "retried"
        ? "这条任务上次没启动起来,已经重新开工"
        : "这条任务已经在开发了",
      { description: d.title },
    );
    return;
  }
  if (launching.has(d.key)) return;
  launching.add(d.key);
  try {
    // 用当前分支开发时两条任务可能落在同一个目录:照样开,但要说清楚
    const other = otherTaskOnDir(dir, d.key);
    if (other) {
      toast.warning(`${baseName(dir)} 里已有「${other.title}」在开发`, {
        description: "两个会话会改同一个工作区,改动会搅在一起",
      });
    }
    if (!(await ref.current.dirUsable(dir))) return;
    // 聊天进程只在授权过的目录里起;新 tab 的终端也会去授权,但那是异步的,
    // 会和聊天启动抢时机,所以这里先等它授权完
    try {
      await native.workspaceAuthorize(dir);
    } catch (e) {
      toast.error("这个目录授权没通过,AI 起不来", {
        description: `${dir}\n${String(e)}`,
      });
      return;
    }
    const p = ref.current;
    // 开 tab 和起会话必须在同一个 tick 里,见 launchChatInLeaf
    const { tabId, leafId } = p.newAgentTab(dir, d.title);
    launchChatInLeaf(leafId, dir, d.agent, d.prompt);
    rememberChatTask(d.key, {
      tabId,
      leafId,
      dir,
      title: d.title,
      at: Date.now(),
      seen: false,
      agent: d.agent,
      prompt: d.prompt,
    });
    // 顶部「当前云效需求」跟着指到这条任务(空地址会把原来的清掉,不写)
    if ((d.url ?? "").trim()) {
      try {
        setTaskLink(dir, d.url);
      } catch {}
      p.bumpLinks();
    }
    watchStart(d, leafId, dir);
  } finally {
    launching.delete(d.key);
  }
}

/**
 * 接 START_CHAT_TASK:在任务目录新开一个聊天 tab,起一个全新的会话(改文件
 * 前先问),把第一条消息发出去。同一条任务的 tab 还开着就切过去,不重发。
 * App 里调一次。
 */
export function useChatTaskLauncher(params: Params) {
  const ref = useRef(params);
  useLayoutEffect(() => {
    ref.current = params;
  });
  /** spaces 恢复完之前收到的请求:那时开的 tab 会被 replaceTabs 冲掉,先攒着。 */
  const pending = useRef<StartChatTaskDetail[]>([]);

  useEffect(
    () =>
      bindChatTaskHost({
        tabs: () => ref.current.tabsRef.current,
        focus: (tabId, leafId) =>
          ref.current.activateAgentTarget(tabId, leafId),
        ready: () => ref.current.booted,
        retry: (key, e) => {
          if (!e.agent || !e.prompt) return;
          retry(
            {
              key,
              dir: e.dir,
              title: e.title,
              prompt: e.prompt,
              url: "",
              agent: e.agent,
            },
            e.leafId,
            e.dir,
          );
        },
      }),
    [],
  );

  useEffect(() => {
    const onRequest = (e: Event) => {
      const d = (e as CustomEvent<StartChatTaskDetail>).detail;
      if (!d?.key || !d.dir) return;
      if (!ref.current.booted) {
        pending.current.push(d);
        return;
      }
      void launch(d, ref);
    };
    window.addEventListener(START_CHAT_TASK, onRequest);
    return () => window.removeEventListener(START_CHAT_TASK, onRequest);
  }, []);

  const { booted } = params;
  useEffect(() => {
    if (!booted) return;
    for (const d of pending.current.splice(0)) void launch(d, ref);
  }, [booted]);
}
