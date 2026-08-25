import { native } from "@/modules/ai/lib/native";
import { GIT_BRANCH_CHANGED_EVENT } from "@/modules/android-run/BranchChip";
import { useEffect, useState } from "react";

// `nonce` forces a re-resolve (e.g. on command finish) so `git checkout` shows.
export function useGitBranch(cwd: string | null, nonce = 0): string | null {
  const [branch, setBranch] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a manual re-resolve trigger
  useEffect(() => {
    if (!cwd) {
      setBranch(null);
      return;
    }
    let alive = true;
    const read = () => {
      native
        .gitResolveRepo(cwd)
        .then((repo) => {
          if (alive) setBranch(repo?.branch || null);
        })
        .catch(() => {
          if (alive) setBranch(null);
        });
    };
    read();
    // 在 BranchChip 里切完分支会广播这个事件;这里不跟着刷,输入栏的
    // 分支 chip 就要等到下一条命令跑完才变,和旁边已经变了的顶栏打架。
    window.addEventListener(GIT_BRANCH_CHANGED_EVENT, read);
    return () => {
      alive = false;
      window.removeEventListener(GIT_BRANCH_CHANGED_EVENT, read);
    };
  }, [cwd, nonce]);

  return branch;
}
