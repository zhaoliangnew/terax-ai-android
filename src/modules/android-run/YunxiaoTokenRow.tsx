import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";
import { setYunxiaoToken, TOKEN_HELP_URL } from "./lib/codeupApi";
import { openExternally } from "./lib/openExternally";

/** 云效个人访问令牌没配时的引导行:粘贴、保存、跳去申请页。 */
export function YunxiaoTokenRow({
  onSaved,
}: {
  onSaved: (token: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-col gap-1.5 rounded border border-amber-500/40 bg-amber-500/5 p-2">
      <div className="text-[11px] leading-relaxed text-muted-foreground">
        调用云效接口需要个人访问令牌(只保存在本机),需要"代码管理"读写权限。
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="粘贴令牌 pt-…"
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded border border-input bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring"
        />
        <Button
          size="sm"
          disabled={!draft.trim()}
          onClick={() => {
            setYunxiaoToken(draft);
            toast.success("令牌已保存");
            onSaved(draft.trim());
          }}
          className="h-7 shrink-0 text-xs"
        >
          保存
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => openExternally(TOKEN_HELP_URL)}
          className="h-7 shrink-0 text-xs"
        >
          去获取
        </Button>
      </div>
    </div>
  );
}
