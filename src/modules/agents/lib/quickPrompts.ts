import { create } from "zustand";

/** 输入框上方分支那一行的快捷指令:点一下就把整理好的话发给 AI。 */
export type QuickPrompt = {
  id: string;
  /** 按钮上的字,越短越好。 */
  label: string;
  /** 发出去的话。 */
  text: string;
  /** 点了要再点一次才发(会动到外面的:提交推送、装设备…)。 */
  confirm?: boolean;
  /** 菜单里的分组;不填归到"我的"。 */
  group?: string;
};

/** 内置项的分组(菜单按这个顺序排,自己加的分组排在后面)。 */
export const QUICK_PROMPT_GROUPS = [
  "代码",
  "分析",
  "设计",
  "会话",
  "提交发布",
  "钉钉",
];
const DEFAULT_GROUP: Record<string, string> = {
  review: "代码",
  fix: "代码",
  verify: "代码",
  debug: "分析",
  "req-review": "分析",
  design: "设计",
  "design-polish": "设计",
  plan: "分析",
  explain: "分析",
  project: "分析",
  continue: "会话",
  sync: "会话",
  summary: "会话",
  commit: "提交发布",
  push: "提交发布",
  install: "提交发布",
  "dt-check": "钉钉",
  "dt-reply": "钉钉",
};
export const MY_GROUP = "我的";

/** 按分组归好,组内保持原顺序;内置分组在前,自定义分组和"我的"在后。 */
export function groupQuickPrompts(
  prompts: QuickPrompt[],
): { group: string; items: QuickPrompt[] }[] {
  const map = new Map<string, QuickPrompt[]>();
  for (const p of prompts) {
    const g = p.group?.trim() || MY_GROUP;
    map.set(g, [...(map.get(g) ?? []), p]);
  }
  const order = (g: string) => {
    const i = QUICK_PROMPT_GROUPS.indexOf(g);
    return i >= 0 ? i : g === MY_GROUP ? 1000 : 500;
  };
  return [...map.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([group, items]) => ({ group, items }));
}

/** 内置的几个(id 固定,按钮图标按 id 配)。 */
const RAW_DEFAULTS: QuickPrompt[] = [
  {
    id: "review",
    label: "Review",
    text: [
      "请 review 当前还没提交的改动,只检查、先不要改代码。",
      "",
      "先用 `git status`、`git diff`、`git diff --cached` 看清改了哪些文件,新增的文件也要完整读一遍;工作区没有未提交的改动就 review 最近一次提交(`git show HEAD`)。必要时去读改动涉及的调用方和上下文,不要只看 diff 片段下结论。",
      "",
      "重点找:",
      "1. 会导致崩溃、逻辑错误、数据错乱或业务流程走不通的问题;",
      "2. 边界和异常:空值、网络失败或超时、重复点击、页面生命周期、线程与并发;",
      "3. 改动有没有影响原有功能,有没有漏改的调用方或配置;",
      "4. 明显不符合项目现有写法和规范的地方。",
      "",
      "每个问题写清:文件:行号、怎么触发、会造成什么后果、建议怎么改,按严重程度从高到低排。没把握的标明是推测;没发现问题就直接说没有,不要硬凑。",
    ].join("\n"),
  },
  {
    id: "fix",
    label: "修复",
    text: [
      "把刚才 review 发现的问题修掉。",
      "",
      "- 按严重程度从高到低逐条修,只改和这些问题相关的代码,不要顺手重构或改别的;",
      "- 标明是推测、或者需要我拿主意的(改业务规则、改交互、影响面大的),先列出来问我,不要自己定;",
      "- 修之前先确认问题在当前代码里还存在,已经不存在的说明一下跳过;",
      "- 改完自己再看一遍 diff,能编译或跑测试的就跑一下。",
      "",
      "最后逐条说明:哪个问题、改了哪个文件、怎么改的、怎么验证的。",
    ].join("\n"),
  },
  {
    id: "sync",
    label: "同步",
    text: [
      "代码刚被其他 code agent(或我手动)改过,你之前读到的文件内容可能已经过时,不要沿用上下文里的旧代码。",
      "",
      "请先重新看当前状态:`git status`、`git diff`、`git log -5 --stat`,再重新读和我们当前任务相关的文件,一切以磁盘上的最新内容为准。",
      "",
      "看完简单总结:哪些文件变了、变了什么、对我们正在做的事有什么影响(比如之前的结论或计划还成不成立)。然后等我下一步指示,先不要改代码。",
    ].join("\n"),
  },
  {
    id: "verify",
    label: "自测",
    text: [
      "对当前改动做一遍自测验证。",
      "",
      "- 先编译(安卓工程用项目现有的 Gradle 任务,其他按项目自己的构建命令),有报错就修;",
      "- 跑和改动相关的单元测试,没有现成测试就说明;",
      "- 对照这次需求列出要人工验证的场景和步骤(正常流程、异常和边界各几条),能在设备上验的写清楚怎么操作、看哪里。",
      "",
      "最后汇总:哪些已验证通过、哪些没法自动验证需要我手动确认、发现的问题。",
    ].join("\n"),
  },
  {
    id: "debug",
    label: "排查",
    text: [
      "帮我排查这个问题:【问题现象,在哪台设备/哪个页面、怎么操作出现的】。先定位原因,不要急着改代码。",
      "",
      "- 先复述你理解的现象和预期;",
      "- 从日志、报错堆栈和相关代码入手,顺着调用链找根因,说清楚证据(哪一行、哪条日志);",
      "- 原因有多种可能的,按可能性排序,写出怎么验证每一种;",
      "- 确认根因后给出修改方案和影响范围,等我同意再改。",
    ].join("\n"),
  },
  {
    id: "plan",
    label: "出方案",
    text: [
      "先别动手写代码,针对这个需求给我出方案:【需求描述,或贴云效需求链接】",
      "",
      "- 先说清你理解的需求和现状(相关代码在哪、现在是怎么做的);",
      "- 给 2~3 个可行方案,每个写:怎么改、改哪些地方、优缺点、风险和工作量;",
      "- 推荐一个并说明理由;有需要我拍板的点单独列出来。",
      "",
      "等我确认后再开始改。",
    ].join("\n"),
  },
  {
    id: "continue",
    label: "继续",
    text: "继续刚才没做完的,接着上一步往下做。做完一个阶段简单说下进度;遇到需要我决定的再停下来问我。",
  },
  {
    id: "req-review",
    label: "需求评估",
    text: [
      "用 leniu-android-requirement-review 技能评估这个需求:【云效需求链接,或需求单/截图说明】",
      "",
      "- 只评估设备侧需求是否清楚、闭环、可判定、可验收,列出缺失、矛盾、需要和产品确认的问题,按严重程度排;",
      "- 结果直接在对话里给我看就行,不要在仓库里创建或修改任何文件(不要落地 .doc/requirement/ 下的评审文档),也不要改代码;",
      "- 链接打不开或内容不全,先告诉我缺什么。",
    ].join("\n"),
  },
  {
    id: "design",
    label: "高保真设计",
    text: [
      "给【要设计的页面/功能,或贴需求链接】出一版高保真视觉设计稿。要像真机截图,不要交互流程图、线框图、方框示意图。",
      "",
      "- 用 leniu-android-product-design 技能:复制它的 assets/design-template 模板,用 styles.js 里 current: true 的「现状沿用」风格;",
      "- 先读项目里现有页面的代码和资源(colors.xml、themes、dimens、图标、已有截图),颜色、字号、圆角、间距、组件样式和现有页面保持一致,按设备真实分辨率和横竖屏出图;",
      "- 用真实业务内容(菜名、金额、重量、人名等),不要 Lorem 和灰色占位块;正常、空、加载、异常、成功等关键状态都画出来;",
      "- 视觉有层级:主操作突出,对齐整齐,留白统一,不加流程箭头和大段说明框;",
      "- 只设计这次要做的范围,不删页面已有功能;拿不准现有主题色、尺寸的先问我。",
      "",
      "做完自己截图检查一遍有没有错位、溢出、文字截断,再把 HTML 路径给我,我在右栏浏览器里看。",
    ].join("\n"),
  },
  {
    id: "design-polish",
    label: "美化设计",
    text: [
      "刚才的设计太像交互示意图/线框图,不好看。范围和功能不变(不要删功能),按高保真标准重做这一版:",
      "",
      "- 套用 leniu-android-product-design 的设计模板和项目现有视觉(颜色、字号、圆角、间距、组件),做成像真机截图的样子;",
      "- 去掉流程箭头、说明框、灰色占位块,换成真实业务内容,补齐关键状态(空、加载、异常、成功);",
      "- 主次分明、对齐和留白统一,按 leniu-android-ui-review 的视觉标准自查一遍;",
      "",
      "改完截图自检,再把 HTML 路径给我。",
    ].join("\n"),
  },
  {
    id: "explain",
    label: "讲解",
    text: [
      "用通俗的话给我讲解【哪块代码/哪个功能/这次改动】:",
      "",
      "- 它解决什么问题、整体流程是怎样的(入口在哪、数据怎么流、最后到哪);",
      "- 关键的类和方法各自负责什么;",
      "- 有哪些容易踩坑或需要特别注意的地方。",
      "",
      "只讲解,不要改代码。",
    ].join("\n"),
  },
  {
    id: "project",
    label: "了解项目",
    text: [
      "先了解一下这个项目,只读不改:",
      "",
      "- 先看 README、CLAUDE.md、AGENTS.md 和构建配置;",
      "- 说清它是做什么的、技术栈、目录结构和主要模块、入口在哪;",
      "- 怎么编译、运行、打包,有哪些项目约定或规范需要注意。",
      "",
      "简洁一点,后面我们在这个基础上干活。",
    ].join("\n"),
  },
  {
    id: "commit",
    label: "提交本地",
    confirm: true,
    text: [
      "把本次任务的改动提交到本地 Git,直接执行,不用再向我确认,不要推送。",
      "",
      "- 先查看 `git status`、`git diff`、`git diff --cached` 和新增文件,只提交本次任务相关的改动;",
      "- 保留其他任务或会话的改动及暂存状态;",
      "- 提交说明参考 `git log -10` 里本仓库的写法和语言,第一行说清变化,正文说明原因和主要改动;",
      "- 提交后告诉我提交哈希和简要内容。",
    ].join("\n"),
  },
  {
    id: "push",
    label: "提交推送",
    confirm: true,
    text: [
      "把当前的改动提交并推送。",
      "",
      "- 先 `git status`、`git diff` 看清改了什么,只提交这次任务相关的文件,不相关的(别人或别的会话改的、临时文件)先问我;",
      "- 提交说明参考 `git log -10` 里本仓库的写法和语言,改动内容不相关的分成几次提交;",
      "- 推送前先 `git fetch`,远端有新提交就 rebase 到最新再推,有冲突停下来告诉我,不要强推;",
      "- 当前在主分支而仓库习惯走分支/MR 的,先问我。",
      "",
      "最后告诉我提交了哪几条、推到了哪个分支。",
    ].join("\n"),
  },
  {
    id: "install",
    label: "打包安装",
    confirm: true,
    text: [
      "按这个项目平时的方式打包,并装好让我能直接试:",
      "",
      "- 安卓工程:编译 debug 包(用项目现有的 Gradle 任务和变体),装到当前连接的设备(`adb devices` 看设备,多台先问我装哪台)并启动;",
      "- 其他项目:按项目自己的构建命令打包,能装到本机的直接装好;",
      "- 编译失败先修,修不了把报错告诉我。",
      "",
      "最后告诉我包在哪、装到了哪、我该怎么验证。",
    ].join("\n"),
  },
  {
    id: "dt-check",
    label: "钉钉排查",
    text: [
      "用 dt 技能看一下钉钉上【姓名】最近发给我的消息,有图片就下载下来一起看。",
      "",
      "- 先整理他反馈的是什么问题:现象、哪台设备/哪个版本、什么场景下出现、他的期望;",
      "- 再结合当前项目的代码和日志排查原因,说清证据(哪段代码、哪条日志);",
      "- 信息不够定位的,列出还需要他提供什么。",
      "",
      "先把排查结论给我看,不要直接回复他。",
    ].join("\n"),
  },
  {
    id: "dt-reply",
    label: "回复钉钉",
    text: [
      "把刚才的排查结果整理成一条发给【姓名】的钉钉消息:",
      "",
      "- 第一句直接说结论;再说原因和怎么处理,或者需要他配合提供什么;",
      "- 口语化、简短,不贴大段代码和内部路径。",
      "",
      "先把消息内容给我看,然后用 AskUserQuestion 问我「发送 / 不发」让我点选;我选发送再用 dt 技能发给他。",
    ].join("\n"),
  },
  {
    id: "summary",
    label: "总结进度",
    text: [
      "整理一份当前进度汇报:",
      "",
      "- 当前目标;",
      "- 已完成的工作和结果;",
      "- 未完成事项、当前问题和需要确认的事项;",
      "- 下一步计划。",
      "",
      "适合直接用于工作汇报,简洁清楚,突出进度和结果,不贴大段代码和内部文件路径。",
    ].join("\n"),
  },
];

/** 内置项旧版文案里的一句:存下来的还是旧文案就换成新的。 */
const OLD_DEFAULT_TEXT_START: Record<string, string> = {
  plan: "先别动手写代码,给我出方案。",
  debug: "帮我排查这个问题,先定位原因",
  explain: "用通俗的话给我讲解当前这块代码/这次改动:",
  "dt-reply": "我说可以了再用 dt 技能发给他。",
  summary: "简洁一点,方便我换个会话或交给别人接着做。",
  commit: "只写说明给我看,不要执行 git commit。",
};

export const DEFAULT_QUICK_PROMPTS: QuickPrompt[] = RAW_DEFAULTS.map((p) => ({
  ...p,
  group: DEFAULT_GROUP[p.id],
}));

const KEY = "terax.chat.quickPrompts";
/** 保存时已经有的内置 id:以后新加的内置项自动补进来,用户删掉的不会回来。 */
const SEEN_KEY = "terax.chat.quickPrompts.seenDefaults";

function load(): QuickPrompt[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_QUICK_PROMPTS;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return DEFAULT_QUICK_PROMPTS;
    const saved: QuickPrompt[] = list
      .filter(
        (p) => p && typeof p.label === "string" && typeof p.text === "string",
      )
      .map((p) => ({ ...p, id: String(p.id ?? crypto.randomUUID()) }));
    // 内置项的文案改过(比如加了【】要填的空),用户没改过的跟着换成新的
    for (const p of saved) {
      const old = OLD_DEFAULT_TEXT_START[p.id];
      const d = DEFAULT_QUICK_PROMPTS.find((x) => x.id === p.id);
      if (old && d && p.text.includes(old)) {
        p.text = d.text;
        if (p.id === "commit") {
          if (p.label === "提交说明") p.label = d.label;
          p.confirm = true;
        }
      }
    }
    // 早先存下的内置项没有分组:按默认补上
    for (const p of saved) {
      if (p.group === undefined && DEFAULT_GROUP[p.id])
        p.group = DEFAULT_GROUP[p.id];
    }
    // 早先存下的内置项没有 confirm 字段:按默认补上(用户关掉过的是 false,不动)
    for (const p of saved) {
      const d = DEFAULT_QUICK_PROMPTS.find((x) => x.id === p.id);
      if (d?.confirm && p.confirm === undefined) p.confirm = true;
    }
    const seen = new Set<string>(
      JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"),
    );
    const added = DEFAULT_QUICK_PROMPTS.filter(
      (d) => !seen.has(d.id) && !saved.some((p) => p.id === d.id),
    );
    return [...saved, ...added];
  } catch {
    return DEFAULT_QUICK_PROMPTS;
  }
}

export const useQuickPrompts = create<{
  prompts: QuickPrompt[];
  save: (prompts: QuickPrompt[]) => void;
}>((set) => ({
  prompts: load(),
  save: (prompts) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prompts));
      localStorage.setItem(
        SEEN_KEY,
        JSON.stringify(DEFAULT_QUICK_PROMPTS.map((d) => d.id)),
      );
    } catch {}
    set({ prompts });
  },
}));
