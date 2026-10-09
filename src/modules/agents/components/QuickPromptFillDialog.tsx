import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEffect, useMemo, useState } from "react";
import type { QuickPrompt } from "../lib/quickPrompts";

/** 快捷指令里要填的空:【姓名】【问题现象,在哪台设备…】。 */
const BLANK_RE = /【([^】]*)】/g;

export function quickPromptBlanks(text: string): string[] {
  return [...text.matchAll(BLANK_RE)].map((m) => m[1]);
}

/**
 * 带空的快捷指令:弹框按空逐个填,可以再补充几句,点发送才发。
 * 以前是塞进输入框让人自己找【】替换,长的一段很容易填错位置。
 */
export function QuickPromptFillDialog({
  prompt,
  onCancel,
  onSend,
}: {
  prompt: QuickPrompt | null;
  onCancel: () => void;
  onSend: (text: string) => void;
}) {
  const blanks = useMemo(
    () => (prompt ? quickPromptBlanks(prompt.text) : []),
    [prompt],
  );
  const [values, setValues] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  useEffect(() => {
    setValues(blanks.map(() => ""));
    setExtra("");
  }, [blanks]);

  const filled =
    values.length === blanks.length && values.every((v) => v.trim());
  const compose = () => {
    if (!prompt) return "";
    let i = 0;
    let text = prompt.text.replace(BLANK_RE, () => values[i++]?.trim() ?? "");
    if (extra.trim()) text += `\n\n补充信息:\n${extra.trim()}`;
    return text;
  };
  const send = () => {
    if (!filled) return;
    onSend(compose());
  };

  return (
    <Dialog open={!!prompt} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="sm:max-w-2xl"
        onKeyDown={(e) => {
          // ⌘/Ctrl + 回车直接发
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{prompt?.label}</DialogTitle>
          <DialogDescription>
            填上下面的空,发出去的完整内容在最下面能看到
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {blanks.map((hint, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 空的个数和顺序跟着这条指令固定,不会增删重排
            <label key={`${i}-${hint}`} className="flex flex-col gap-1">
              <span className="text-[12px] text-muted-foreground">
                {hint || `第 ${i + 1} 项`}
              </span>
              <textarea
                // 第一个空打开就能直接打字
                autoFocus={i === 0}
                rows={hint.length > 8 ? 3 : 1}
                value={values[i] ?? ""}
                onChange={(e) =>
                  setValues((cur) =>
                    cur.map((v, j) => (j === i ? e.target.value : v)),
                  )
                }
                placeholder={hint}
                className="resize-y rounded-md border border-border bg-transparent px-2.5 py-1.5 text-[13px] leading-relaxed outline-none focus:border-ring"
              />
            </label>
          ))}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-muted-foreground">
              补充信息(可选)
            </span>
            <textarea
              rows={3}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="日志路径、版本号、复现步骤、需求链接…想补充什么都可以"
              className="resize-y rounded-md border border-border bg-transparent px-2.5 py-1.5 text-[13px] leading-relaxed outline-none focus:border-ring"
            />
          </label>
        </div>
        {/* 发出去的完整内容:填了的空换成你写的(蓝色),没填的还是【提示】(黄色) */}
        <div className="flex flex-col gap-1">
          <span className="text-[12px] text-muted-foreground">
            将发送的内容
          </span>
          <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md bg-foreground/[0.05] px-3 py-2 text-[12.5px] leading-relaxed text-foreground/85">
            {previewParts(prompt?.text ?? "", values).map((part, i) =>
              part.kind === "text" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: 片段顺序固定
                <span key={i}>{part.text}</span>
              ) : (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: 片段顺序固定
                  key={i}
                  className={
                    part.filled
                      ? "rounded bg-[#2c67c5]/25 px-0.5 text-[#8fb3f0]"
                      : "rounded bg-amber-500/15 px-0.5 text-amber-500"
                  }
                >
                  {part.text}
                </span>
              ),
            )}
            {extra.trim() && `\n\n补充信息:\n${extra.trim()}`}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={!filled}
            title={filled ? "发送(⌘↩)" : "先把上面的空填上"}
            onClick={send}
          >
            发送
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 预览用:把指令按【】切成片段,填了的空换成填的内容。 */
function previewParts(
  text: string,
  values: string[],
): (
  | { kind: "text"; text: string }
  | { kind: "blank"; text: string; filled: boolean }
)[] {
  const out: (
    | { kind: "text"; text: string }
    | { kind: "blank"; text: string; filled: boolean }
  )[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(BLANK_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    const v = values[i++]?.trim();
    out.push(
      v
        ? { kind: "blank", text: v, filled: true }
        : { kind: "blank", text: m[0], filled: false },
    );
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
