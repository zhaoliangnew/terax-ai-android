import { native } from "@/modules/ai/lib/native";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/**
 * "跳到类/函数定义",不依赖任何语言服务器。
 *
 * 为什么不走 LSP:这工具是发给组里其他人用的,LSP 要每个人自己装 jdtls /
 * kotlin-language-server(几百 MB、还得配 JDK),装不上的人就等于没有这个功能。
 * 而"跳到定义"九成场景就是"这个名字在哪儿声明的" —— 用声明式的正则在工程里
 * 搜一遍就够,后端本来就有 ripgrep 那套(ignore + grep-regex,并行、认
 * .gitignore),现成的快。
 *
 * 代价是它不理解作用域:同名方法会给出多条,由使用者自己挑。所以命中多于一条
 * 时弹列表,而不是猜一个跳过去。
 */

/** 找什么:声明处,还是所有用到它的地方。 */
export type SymbolMode = "definition" | "reference";

export type SymbolHit = {
  path: string;
  /** 相对工程根,列表里显示用。 */
  rel: string;
  line: number;
  text: string;
};

/** 正则元字符转义 —— 名字里可能有 `$`(内部类)之类。 */
function escapeRe(s: string): string {
  return s.replace(/[\\.+*?()|[\]{}^$]/g, "\\$&");
}

/**
 * 声明式模式:各语言"定义一个东西"的常见写法。
 *
 * 后端用的是 Rust regex,没有环视,所以这里只做粗筛,精筛放到客户端
 * (`looksLikeDeclaration`)—— 那边能用环视,把 `return foo(` 这种调用点剔掉。
 */
function declarationPattern(name: string, prefix = false): string {
  // prefix:按"以这几个字打头"匹配,给 Shift-Shift 那种边打边找用
  const n = prefix ? `${escapeRe(name)}[\\w$]*` : escapeRe(name);
  const end = prefix ? "" : "\\b";
  return [
    // class Foo / interface Foo / enum Foo / object Foo / struct Foo …
    `\\b(class|interface|enum|record|object|trait|struct|protocol|extension|typealias|type)\\s+${n}${end}`,
    // fun foo( / def foo( / func foo( / function foo(
    `\\b(fun|def|func|function)\\s+${n}\\s*[(<]`,
    // val foo = / var foo: / const foo = / let foo =
    `\\b(val|var|let|const)\\s+${n}\\s*[:=]`,
    // Java/Kotlin 方法:修饰符 … 返回类型 foo(
    `\\b(public|private|protected|internal|static|final|abstract|synchronized|override|suspend|open)\\b[\\w\\s<>,\\[\\].?]*\\b${n}\\s*\\(`,
    // 无修饰符的方法/函数:行首缩进 + 返回类型 + foo(
    `^\\s*[A-Za-z_$][\\w<>,\\[\\].?$]*\\s+${n}\\s*\\(`,
    // 字段:修饰符 … 类型 foo = / foo;  (private List<X> foo = new …)
    `\\b(public|private|protected|internal|static|final|volatile|transient|lateinit)\\b[\\w\\s<>,\\[\\].?$]*\\b${n}\\s*[=;]`,
    // 无修饰符的字段/局部声明:行首缩进 + 类型 + foo = / foo;
    `^\\s*[A-Za-z_$][\\w<>,\\[\\].?$]*\\s+${n}\\s*[=;]`,
    // foo: function( / foo = (…) =>
    `\\b${n}\\s*[:=]\\s*(function\\b|\\(|async\\b)`,
  ].join("|");
}

/**
 * 粗筛之后再过一遍:排掉那些"看着像声明其实是调用"的行。
 *
 * `return foo(`、`new Foo(`、`= foo(` 都会被上面第 5 条(行首缩进+标识符+
 * 名字+括号)命中 —— 关键字本身就长得像返回类型。
 */
const CALL_KEYWORDS =
  /\b(return|new|throw|await|yield|else|case|in|is|and|or|not|if|while|for|assert)\s*$/;

function looksLikeDeclaration(text: string, name: string): boolean {
  const idx = text.indexOf(name);
  if (idx < 0) return true;
  const before = text.slice(0, idx);
  if (CALL_KEYWORDS.test(before)) return false;
  // `obj.foo(` / `Foo::foo(` 是调用/引用,不是这一行在声明它
  if (/[.:]\s*$/.test(before)) return false;
  return true;
}

/** 光标(或某个位置)所在的标识符。 */
export function wordAt(view: EditorView, pos: number): string | null {
  const range = view.state.wordAt(pos);
  if (!range) return null;
  const word = view.state.sliceDoc(range.from, range.to).trim();
  // 纯数字不是标识符;一个字符的名字搜出来全是噪声
  if (!word || word.length < 2 || /^\d/.test(word)) return null;
  return word;
}

/**
 * 在工程里找 `name`:定义(声明处)或引用(所有用到的地方)。
 *
 * 引用就是整词搜一遍 —— 同样不理解作用域,但"谁调用了这个方法"用它回答够了,
 * 而且同名的东西一般也就是同一个。
 */
export async function findSymbol(
  root: string,
  name: string,
  mode: SymbolMode,
  options?: { maxResults?: number; prefix?: boolean },
): Promise<{ hits: SymbolHit[]; truncated: boolean }> {
  const isDef = mode === "definition";
  const res = await native.grep({
    pattern: isDef
      ? declarationPattern(name, options?.prefix)
      : `\\b${escapeRe(name)}\\b`,
    root,
    maxResults: options?.maxResults ?? (isDef ? 80 : 300),
    // 边打边找的时候不该管大小写(打 setting 也要能找到 SettingActivity);
    // 从代码里点某个标识符跳转时保持区分 —— Java/Kotlin 本来就区分,
    // 不区分只会多出一堆同名噪声
    caseInsensitive: options?.prefix ?? false,
  });
  const rootPrefix = `${root.replace(/\/+$/, "")}/`;
  const hits = res.hits
    .filter((h) => (isDef ? looksLikeDeclaration(h.text, name) : true))
    .map((h) => ({
      path: h.path,
      rel: h.path.startsWith(rootPrefix)
        ? h.path.slice(rootPrefix.length)
        : h.rel,
      line: Number(h.line),
      text: h.text.trim(),
    }));
  if (isDef) {
    // 类型声明排在方法前面,同类按路径
    hits.sort((a, b) => {
      const rank = (t: string) =>
        /\b(class|interface|enum|record|object|trait|struct)\b/.test(t) ? 0 : 1;
      return rank(a.text) - rank(b.text) || a.rel.localeCompare(b.rel);
    });
  } else {
    hits.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line);
  }
  return { hits, truncated: res.truncated };
}

/**
 * 编辑器里的跳转入口:⌘/Ctrl + 点击找调用,加 Shift 跳定义;键盘还是老规矩
 * F12 / ⌘B 跳定义,⇧F12 / ⌥F7 找调用。
 *
 * ⌘点击要 preventDefault —— CodeMirror 默认把它当"加一个光标"(多光标编辑)。
 */
export function symbolJumpExtension(opts: {
  /** false 时整套让位(比如设置里选了只用 LSP),事件继续往下传。 */
  enabled: () => boolean;
  onJump: (name: string, mode: SymbolMode) => void;
}) {
  const fromCursor = (mode: SymbolMode) => (view: EditorView) => {
    if (!opts.enabled()) return false;
    const word = wordAt(view, view.state.selection.main.head);
    if (!word) return false;
    opts.onJump(word, mode);
    return true;
  };
  // 必须是 highest:LSP 那套自己也挂了 ⌘点击(client.ts 的 lspInteractions),
  // 它先返回 true 就把事件吃掉了 —— 现象就是"⌘悬停有下划线,点了没反应"
  // (下划线是 LSP 的 linkHover 画的,但没有语言服务器,跳转请求落空)。
  return [
    Prec.highest(
      keymap.of([
        { key: "F12", run: fromCursor("definition") },
        { key: "Mod-b", run: fromCursor("definition") },
        // 找调用:跟 VS Code 的"转到引用"同一个键
        { key: "Shift-F12", run: fromCursor("reference") },
        { key: "Alt-F7", run: fromCursor("reference") },
      ]),
    ),
    Prec.highest(
      EditorView.domEventHandlers({
        mousedown(event, view) {
          if (!opts.enabled()) return false;
          if (!event.metaKey && !event.ctrlKey) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos == null) return false;
          const word = wordAt(view, pos);
          if (!word) return false;
          event.preventDefault();
          // ⌘点击默认找调用 —— 点在声明上时"跳到定义"等于原地不动,
          // 而"谁调用了它"才是这时候真正想问的。加 Shift 才是跳定义。
          opts.onJump(word, event.shiftKey ? "definition" : "reference");
          return true;
        },
      }),
    ),
  ];
}
