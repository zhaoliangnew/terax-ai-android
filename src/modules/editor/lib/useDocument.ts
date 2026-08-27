import { notifyDocumentSaved } from "@/modules/lsp";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { WORKTREE_CHANGED_EVENT } from "@/modules/source-control/events";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { invalidateFileDiffs } from "./diffCache";
import { detectEol, type Eol, normalizeToLf, restoreEol } from "./eol";

type ReadResult =
  | { kind: "text"; content: string; size: number; mtime: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type FileStat = { size: number; mtime: number; kind: string };

/// Mirrors FORCE_MAX_READ_BYTES in src-tauri fs/file.rs.
export const FORCE_READ_LIMIT = 50 * 1024 * 1024;

export type DocumentState =
  | { status: "loading" }
  | { status: "ready"; content: string; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

type Options = {
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
};

export function useDocument({ path, onDirtyChange }: Options) {
  const [doc, setDoc] = useState<DocumentState>({ status: "loading" });
  const [dirty, setDirty] = useState(false);

  const autoSave = usePreferencesStore((s) => s.editorAutoSave);
  const autoSaveDelay = usePreferencesStore((s) => s.editorAutoSaveDelay);

  // Track the saved buffer so we can detect changes cheaply.
  const savedRef = useRef<string>("");
  const bufferRef = useRef<string>("");
  const eolRef = useRef<Eol>("\n");
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const autoSaveRef = useRef({ autoSave, autoSaveDelay });
  autoSaveRef.current = { autoSave, autoSaveDelay };

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoSaveTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const diskMtimeRef = useRef<number | null>(null);

  const writeToDisk = useCallback(async () => {
    const content = bufferRef.current;
    const mtime = await invoke<number>("fs_write_file", {
      path,
      content: restoreEol(content, eolRef.current),
      workspace: currentWorkspaceEnv(),
      source: "editor",
    });
    diskMtimeRef.current = mtime;
    savedRef.current = content;
    // Edits typed while the write was in flight must stay dirty.
    setDirty(bufferRef.current !== content);
    notifyDocumentSaved(path);
    // 所有写盘都从这里过(手动保存、自动保存、格式化后回写),刷新信号也
    // 必须发在这儿 —— 之前挂在编辑器的手动保存里,自动保存直接调 saveNow
    // 绕过去了,于是"存了但树上不变色、没有 diff 按钮"。
    invalidateFileDiffs(path);
    window.dispatchEvent(new Event(WORKTREE_CHANGED_EVENT));
  }, [path]);

  // False when the write was withheld because the file changed on disk
  // since load; overwriting is an explicit user action from the toast.
  const saveNow = useCallback(async (): Promise<boolean> => {
    const known = diskMtimeRef.current;
    if (known !== null) {
      const stat = await invoke<FileStat>("fs_stat", {
        path,
        workspace: currentWorkspaceEnv(),
      }).catch(() => null);
      if (stat && stat.mtime !== known) {
        const name = path.split(/[\\/]/).pop() ?? path;
        // 这条挡住的往往是自动保存,而自动保存是静默的 —— 不说清楚就成了
        // "打的字莫名其妙没保存"。把"自动保存已暂停"直说,给个覆盖的口子。
        toast.warning("文件在磁盘上被改过了", {
          id: `save-conflict:${path}`,
          description: `${name} 在你编辑期间被其他程序改动过,自动保存已暂停。选"覆盖"保留你的版本。`,
          action: { label: "覆盖", onClick: () => void writeToDisk() },
        });
        return false;
      }
    }
    await writeToDisk();
    return true;
  }, [path, writeToDisk]);

  // Notify parent of dirty transitions.
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  const forceRef = useRef(false);

  // Adopts a read result as the new saved baseline. `skipIfUnchanged` avoids
  // the re-render when disk already matches the buffer (self-save / duplicate
  // watcher event); initial loads must always publish a state.
  const adoptRead = useCallback((res: ReadResult, skipIfUnchanged = false) => {
    if (res.kind === "text") {
      eolRef.current = detectEol(res.content);
      diskMtimeRef.current = res.mtime;
      const content = normalizeToLf(res.content);
      if (skipIfUnchanged && content === savedRef.current) return;
      savedRef.current = content;
      bufferRef.current = content;
      setDirty(false);
      setDoc({ status: "ready", content, size: res.size });
    } else if (res.kind === "binary") {
      setDoc({ status: "binary", size: res.size });
    } else if (res.kind === "toolarge") {
      setDoc({ status: "toolarge", size: res.size, limit: res.limit });
    }
  }, []);

  const readFromDisk = useCallback(
    (force: boolean) =>
      invoke<ReadResult>("fs_read_file", {
        path,
        workspace: currentWorkspaceEnv(),
        force,
      }),
    [path],
  );

  // Load on path change.
  useEffect(() => {
    let cancelled = false;
    // "Open anyway" is a per-file decision; a new path starts unforced.
    forceRef.current = false;
    setDoc({ status: "loading" });
    setDirty(false);

    readFromDisk(forceRef.current)
      .then((res) => {
        if (!cancelled) adoptRead(res);
      })
      .catch((e) => {
        if (!cancelled) setDoc({ status: "error", message: String(e) });
      });

    return () => {
      cancelled = true;
    };
  }, [readFromDisk, adoptRead]);

  const openAnyway = useCallback(() => {
    forceRef.current = true;
    setDoc({ status: "loading" });
    readFromDisk(true)
      .then(adoptRead)
      .catch((e) => setDoc({ status: "error", message: String(e) }));
  }, [readFromDisk, adoptRead]);

  // Skipped while dirty: never clobber unsaved edits. Re-checked when the
  // read resolves, since typing can start while it is in flight.
  const reload = useCallback((): boolean => {
    if (dirtyRef.current) return false;
    void readFromDisk(forceRef.current)
      .then((res) => {
        if (!dirtyRef.current) adoptRead(res, true);
      })
      // Transient failures (e.g. ENOENT mid atomic-rename) must not replace
      // a healthy buffer with an error screen.
      // 文件被删了(比如丢弃一个未跟踪文件)不是错,别刷屏
      .catch((e) => {
        if (!/No such file|os error 2/i.test(String(e))) {
          console.warn("[editor] reload failed", path, e);
        }
      });
    return true;
  }, [readFromDisk, adoptRead, path]);

  /**
   * 无条件按磁盘内容重置缓冲区,连没保存的编辑一起丢 —— 只给"丢弃这个
   * 文件的改动"这种显式操作用。顺手掐掉待写的自动保存,不然一秒后它又
   * 把刚丢掉的内容写回去。
   */
  const forceReloadFromDisk = useCallback((): Promise<string | null> => {
    clearAutoSaveTimer();
    return readFromDisk(forceRef.current)
      .then((res) => {
        adoptRead(res);
        // 把采纳后的文本交回去:调用方要直接写进编辑器视图 ——
        // react-codemirror 在"正在输入"时会把外部更新推迟到一个可能永远
        // 不执行的回调里,只改 React 状态屏幕上不一定跟着变。
        return res.kind === "text" ? normalizeToLf(res.content) : null;
      })
      .catch((e) => {
        console.warn("[editor] force reload failed", path, e);
        return null;
      });
  }, [clearAutoSaveTimer, readFromDisk, adoptRead, path]);

  const save = useCallback(async (): Promise<boolean> => {
    clearAutoSaveTimer();
    if (bufferRef.current === savedRef.current) return true;
    return saveNow();
  }, [clearAutoSaveTimer, saveNow]);

  // Adopt externally formatted disk content as the saved baseline before the
  // matching editor dispatch lands, so the buffer never flashes dirty. The
  // formatter's own write must also become the known mtime, or the next save
  // would report it as an external conflict.
  // Returns the LF-normalized text the caller should dispatch.
  const adoptDiskText = useCallback(
    (diskText: string, mtime: number): string => {
      eolRef.current = detectEol(diskText);
      diskMtimeRef.current = mtime;
      const content = normalizeToLf(diskText);
      savedRef.current = content;
      setDirty(bufferRef.current !== content);
      return content;
    },
    [],
  );

  const onChange = useCallback(
    (next: string) => {
      bufferRef.current = next;
      const isDirty = next !== savedRef.current;
      setDirty(isDirty);

      clearAutoSaveTimer();

      const { autoSave: active, autoSaveDelay: delay } = autoSaveRef.current;
      if (active && isDirty) {
        timeoutRef.current = setTimeout(() => {
          saveNow().catch((e) => console.error("[autosave]", e));
        }, delay);
      }
    },
    [clearAutoSaveTimer, saveNow],
  );

  useEffect(() => clearAutoSaveTimer, [path, clearAutoSaveTimer]);

  return {
    doc,
    dirty,
    onChange,
    save,
    reload,
    forceReloadFromDisk,
    adoptDiskText,
    openAnyway,
  };
}
