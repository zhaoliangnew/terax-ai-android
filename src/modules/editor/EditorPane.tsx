import { endpointIdFromCompatModel } from "@/modules/ai/config";
import { getCustomEndpointKey, getKey } from "@/modules/ai/lib/keyring";
import { lspFormatDocument, useLspExtension } from "@/modules/lsp";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { onKeysChanged } from "@/modules/settings/store";
import {
  WORKTREE_CHANGED_EVENT,
  WORKTREE_DISCARDED_EVENT,
  type WorktreeDiscardedDetail,
} from "@/modules/source-control/events";
import { acceptCompletion, startCompletion } from "@codemirror/autocomplete";
import { redo, undo } from "@codemirror/commands";
import {
  findNext,
  findPrevious,
  gotoLine,
  openSearchPanel,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { convertFileSrc } from "@tauri-apps/api/core";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  inlineCompletion,
  triggerInlineCompletion,
} from "./lib/autocomplete/inlineExtension";
import { diagnosticsReporter } from "./lib/diagnosticsReporter";
import { useDiagnosticsStore } from "./lib/diagnosticsStore";
import {
  buildSharedExtensions,
  DEFAULT_INDENT,
  deleteBlankLineBackward,
  indentCompartment,
  indentExtension,
  languageCompartment,
  lspCompartment,
  vimCompartment,
  wordWrapExtension,
  wrapCompartment,
} from "./lib/extensions";
import {
  applyFormattedContent,
  readFileText,
  resolveFormatter,
  runExternalFormatter,
} from "./lib/externalFormat";
import { detectIndentUnit } from "./lib/indent";
import { type LanguageResult, resolveLanguage } from "./lib/languageResolver";
import { type SymbolMode, symbolJumpExtension } from "./lib/symbolJump";
import { FORCE_READ_LIMIT, useDocument } from "./lib/useDocument";
import { useEditorThemeExt } from "./lib/useEditorThemeExt";
import { initVimGlobals, vimHandlersExtension } from "./lib/vim";

initVimGlobals();

export type EditorPaneHandle = {
  setQuery: (q: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  clearQuery: () => void;
  /** 当前查询的命中总数,以及光标处是第几个(都是 1 基;没命中给 0)。 */
  searchStatus: (q: string) => { index: number; total: number };
  /** Open CodeMirror's find/replace panel. */
  openSearch: () => void;
  focus: () => void;
  getSelection: () => string | null;
  getPath: () => string;
  /** Re-read the file from disk. Skips silently if the buffer is dirty. */
  reload: () => boolean;
  /** Move the cursor to a 1-based line and center it, once content is ready. */
  gotoLine: (line: number, options?: { focus?: boolean }) => void;
  /** Apply CodeMirror's undo/redo commands. */
  undo: () => void;
  redo: () => void;
  /** Request an AI ghost suggestion at the cursor. */
  triggerAiComplete: () => void;
  /** Open CodeMirror's completion popup. */
  triggerCodeComplete: () => void;
};

type Props = {
  path: string;
  overrideLanguage?: string | null;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
  onClose?: () => void;
  /** 给了就开"跳到定义/找调用":⌘点击、F12、⌘B 找定义,加 Shift 找调用。 */
  onJumpToSymbol?: (name: string, mode: SymbolMode) => void;
};

// Above this, syntax highlighting and LSP are disabled: a multi-MB lezer
// parse tree and a didOpen of that size cost far more than they give.
const SYNTAX_MAX_BYTES = 4 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// memo: EditorStack passes identity-stable props, so background editors
// skip re-rendering entirely when App re-renders (terminal events, tab churn).
export const EditorPane = memo(
  forwardRef<EditorPaneHandle, Props>(function EditorPane(props, ref) {
    const { path, overrideLanguage, onDirtyChange, onSaved, onClose } = props;
    // 扩展只建一次(extensions 是 useMemo([]) 的),所以回调走 ref
    const jumpRef = useRef(props.onJumpToSymbol);
    useEffect(() => {
      jumpRef.current = props.onJumpToSymbol;
    }, [props.onJumpToSymbol]);
    /**
     * 内置搜索跳转让不让位给 LSP。
     *
     * 两套都挂着 ⌘点击,谁先返回 true 谁生效。内置这套的优先级是 highest,
     * 所以由它自己判断:该 LSP 上的时候返回 false,事件就落到 LSP 那套手里。
     */
    const jumpStrategy = usePreferencesStore((s) => s.symbolJumpStrategy);
    const searchJumpAllowedRef = useRef(true);

    const {
      doc,
      onChange,
      save,
      reload,
      forceReloadFromDisk,
      adoptDiskText,
      openAnyway,
    } = useDocument({
      path,
      onDirtyChange,
    });
    const reloadRef = useRef(reload);
    reloadRef.current = reload;
    const forceReloadRef = useRef(forceReloadFromDisk);
    forceReloadRef.current = forceReloadFromDisk;
    const pathForReloadRef = useRef(path);
    pathForReloadRef.current = path;
    // 工作区被应用自己改写(丢弃改动、切分支之类)时磁盘内容变了,而编辑器
    // 抱着打开时那份 —— 丢弃完文件还显示着改动就是这么来的。reload 自带
    // 脏检查:有未保存编辑时不覆盖(不能因为别处一个操作就吞掉手上没存的
    // 字),但得说一声,否则"丢弃了却还显示着"看着就像没生效。
    useEffect(() => {
      const onWorktreeChanged = () => {
        // 有未保存的编辑时 reload 自己会让路,静悄悄跳过就行 —— 真去覆盖
        // 磁盘那一下(保存)另有 mtime 冲突提示兜着,这里再弹一个纯属噪音。
        reloadRef.current();
      };
      window.addEventListener(WORKTREE_CHANGED_EVENT, onWorktreeChanged);
      // 终端里 git checkout / 别的编辑器改了文件,不会走上面那个事件 ——
      // 窗口回到前台时对一次盘,和别的 IDE 一个习惯。这条只在内容真变了
      // 才会重渲染(adoptRead 的 skipIfUnchanged)。
      const onFocus = () => {
        reloadRef.current();
      };
      window.addEventListener("focus", onFocus);
      // 显式丢弃:这个文件的改动都不要了,没保存的编辑也一起扔,
      // 否则自动保存过一秒又把它写回磁盘,看着像丢弃没生效。
      const onDiscarded = (e: Event) => {
        const detail = (e as CustomEvent<WorktreeDiscardedDetail>).detail;
        if (!detail) return;
        const mine = pathForReloadRef.current.replace(/\\/g, "/");
        // 绝对路径可能因为软链/规范化(/private 前缀之类)对不上,
        // 再按"仓库内相对路径"兜一次底。
        const hit =
          detail.paths?.some((p) => p.replace(/\\/g, "/") === mine) ||
          detail.relPaths?.some((rel) => {
            const r = rel.replace(/\\/g, "/").replace(/^\/+/, "");
            return mine === r || mine.endsWith(`/${r}`);
          });
        if (!hit) return;
        void forceReloadRef.current().then((text) => {
          const view = cmRef.current?.view;
          if (text == null || !view) return;
          // 直接写进视图:光改 React 状态时,react-codemirror 会因为
          // "用户刚在打字"把外部更新推迟掉,屏幕上还留着已经被丢弃的内容。
          if (view.state.doc.toString() === text) return;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
          });
        });
      };
      window.addEventListener(WORKTREE_DISCARDED_EVENT, onDiscarded);
      return () => {
        window.removeEventListener(WORKTREE_CHANGED_EVENT, onWorktreeChanged);
        window.removeEventListener(WORKTREE_DISCARDED_EVENT, onDiscarded);
        window.removeEventListener("focus", onFocus);
      };
    }, []);
    const adoptDiskTextRef = useRef(adoptDiskText);
    adoptDiskTextRef.current = adoptDiskText;
    const cmRef = useRef<ReactCodeMirrorRef>(null);
    const themeExt = useEditorThemeExt();
    const vimMode = usePreferencesStore((s) => s.vimMode);
    const wordWrapColumn = usePreferencesStore((s) =>
      s.editorWordWrap ? s.editorWordWrapColumn : null,
    );
    const languageRef = useRef<string | null>(null);
    const [langId, setLangId] = useState<string | null>(null);
    const apiKeyRef = useRef<string | null>(null);

    useEffect(() => {
      let cancelled = false;
      const refresh = async () => {
        const s = usePreferencesStore.getState();
        const provider = s.autocompleteProvider;
        if (
          provider === "lmstudio" ||
          provider === "mlx" ||
          provider === "ollama"
        ) {
          apiKeyRef.current = null;
          return;
        }
        // OpenAI-compatible keys live in a per-endpoint keyring slot.
        if (provider === "openai-compatible") {
          const eid = endpointIdFromCompatModel(s.autocompleteModelId);
          const k = eid ? await getCustomEndpointKey(eid) : null;
          if (!cancelled) apiKeyRef.current = k;
          return;
        }
        const k = await getKey(provider);
        if (!cancelled) apiKeyRef.current = k;
      };
      void refresh();
      let unlistenKeys: (() => void) | undefined;
      void onKeysChanged(() => void refresh()).then((un) => {
        if (cancelled) un();
        else unlistenKeys = un;
      });
      const unsubPrefs = usePreferencesStore.subscribe((state, prev) => {
        if (
          state.autocompleteProvider !== prev.autocompleteProvider ||
          state.autocompleteModelId !== prev.autocompleteModelId
        ) {
          void refresh();
        }
      });
      return () => {
        cancelled = true;
        unlistenKeys?.();
        unsubPrefs();
      };
    }, []);
    // Stabilize save + onSaved via refs so the extensions array never changes
    // identity — a new identity makes @uiw/react-codemirror reconfigure the
    // whole state, wiping the language compartment.
    const saveRef = useRef(save);
    saveRef.current = save;
    const onSavedRef = useRef(onSaved);
    onSavedRef.current = onSaved;
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const lspActiveRef = useRef(false);
    const warnedNoLspRef = useRef(false);
    const warnedNoFormatRef = useRef(false);

    const performSave = useCallback(async () => {
      const view = cmRef.current?.view;
      const prefs = usePreferencesStore.getState();
      const formatter = resolveFormatter(languageRef.current, prefs);
      if (prefs.editorFormatOnSave && formatter === "lsp" && view) {
        if (lspActiveRef.current) {
          let res: "done" | "unsupported" = "done";
          try {
            res = await lspFormatDocument(view);
          } catch (e) {
            toast.error("Language server format failed", {
              description: String(e),
            });
          }
          if (res === "unsupported" && !warnedNoFormatRef.current) {
            warnedNoFormatRef.current = true;
            toast.warning("Format on save skipped", {
              description:
                "The active language server has no formatter. Pick an external one in Settings (Ruff for Python, Prettier, rustfmt, ...).",
            });
          }
        } else if (!warnedNoLspRef.current) {
          warnedNoLspRef.current = true;
          toast.warning("Format on save skipped", {
            description:
              "No active language server for this file. Enable one in the statusbar, or pick an external formatter in Settings.",
          });
        }
      }
      // Snapshot before save: edits typed during the formatter round-trip
      // must not be clobbered by the disk read-back.
      const docAtSave = view?.state.doc;
      const saved = await saveRef.current();
      if (!saved) return;
      if (prefs.editorFormatOnSave && formatter !== "lsp") {
        const error = await runExternalFormatter(
          formatter,
          pathRef.current,
          prefs.editorCustomFormatCommand,
        );
        if (error) {
          toast.error(`${formatter} format failed`, { description: error });
        } else {
          const readBack = await readFileText(pathRef.current);
          if (readBack !== null && view && view.state.doc === docAtSave) {
            applyFormattedContent(
              view,
              adoptDiskTextRef.current(readBack.text, readBack.mtime),
            );
          }
        }
      }
      onSavedRef.current?.();
      // 刷新信号统一在 useDocument 的写盘出口发(自动保存不走这儿)
    }, []);
    const performSaveRef = useRef(performSave);
    performSaveRef.current = performSave;

    const pathRef = useRef(path);
    pathRef.current = path;

    const pendingLineRef = useRef<{
      path: string;
      line: number;
      focus: boolean;
    } | null>(null);
    const pendingFocusRef = useRef<string | null>(null);
    const statusRef = useRef(doc.status);
    useLayoutEffect(() => {
      statusRef.current = doc.status;
    }, [doc.status]);

    useEffect(() => {
      if (pendingLineRef.current?.path !== path) {
        pendingLineRef.current = null;
      }
      if (pendingFocusRef.current !== path) {
        pendingFocusRef.current = null;
      }
    }, [path]);

    const focusWhenRendered = useCallback(
      (view: EditorView, targetPath: string) => {
        requestAnimationFrame(() => {
          if (cmRef.current?.view === view && pathRef.current === targetPath) {
            view.focus();
          }
        });
      },
      [],
    );

    const applyPendingGoto = useCallback(() => {
      const view = cmRef.current?.view;
      const pending = pendingLineRef.current;
      if (!view || pending == null || statusRef.current !== "ready") return;
      if (pending.path !== path) {
        pendingLineRef.current = null;
        return;
      }
      const target = Math.max(1, Math.min(pending.line, view.state.doc.lines));
      const at = view.state.doc.line(target).from;
      view.dispatch({
        selection: { anchor: at },
        effects: EditorView.scrollIntoView(at, { y: "center" }),
      });
      if (pending.focus) focusWhenRendered(view, pending.path);
      pendingLineRef.current = null;
    }, [focusWhenRendered, path]);

    const applyPendingFocus = useCallback(() => {
      const view = cmRef.current?.view;
      const pendingPath = pendingFocusRef.current;
      if (!view || pendingPath === null || statusRef.current !== "ready")
        return;
      pendingFocusRef.current = null;
      if (pendingPath === path) focusWhenRendered(view, pendingPath);
    }, [focusWhenRendered, path]);

    useEffect(() => {
      if (doc.status !== "ready") return;
      applyPendingGoto();
      applyPendingFocus();
    }, [doc.status, applyPendingFocus, applyPendingGoto]);

    const extensions = useMemo(
      () => [
        // basicSetup is added before user extensions by @uiw/react-codemirror,
        // so we must elevate vim's precedence to win the keymap.
        vimCompartment.of(
          usePreferencesStore.getState().vimMode ? Prec.highest(vim()) : [],
        ),
        wrapCompartment.of(
          wordWrapExtension(
            usePreferencesStore.getState().editorWordWrap
              ? usePreferencesStore.getState().editorWordWrapColumn
              : null,
          ),
        ),
        vimHandlersExtension(() => ({
          save: () => {
            void performSaveRef.current();
          },
          close: () => onCloseRef.current?.(),
        })),
        ...buildSharedExtensions(),
        // 空白行上退格 = 整行删掉回到上一行(见 deleteBlankLineBackward)
        Prec.highest(
          keymap.of([{ key: "Backspace", run: deleteBlankLineBackward }]),
        ),
        indentCompartment.of(DEFAULT_INDENT),
        languageCompartment.of([]),
        lspCompartment.of([]),
        diagnosticsReporter(() => pathRef.current),
        symbolJumpExtension({
          enabled: () => searchJumpAllowedRef.current && !!jumpRef.current,
          onJump: (name, mode) => jumpRef.current?.(name, mode),
        }),
        // Before inlineCompletion so an open popup wins Tab over the ghost.
        Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
        inlineCompletion({
          getPrefs: () => {
            const s = usePreferencesStore.getState();
            const p = s.autocompleteProvider;
            // autocompleteModelId holds the compat- id of the chosen endpoint.
            const compatEp =
              p === "openai-compatible"
                ? s.customEndpoints.find(
                    (e) =>
                      e.id === endpointIdFromCompatModel(s.autocompleteModelId),
                  )
                : undefined;
            const modelId =
              p === "lmstudio"
                ? s.lmstudioModelId
                : p === "mlx"
                  ? s.mlxModelId
                  : p === "ollama"
                    ? s.ollamaModelId
                    : p === "openai-compatible"
                      ? (compatEp?.modelId ?? "")
                      : p === "openrouter"
                        ? s.openrouterModelId
                        : s.autocompleteModelId;
            return {
              enabled: s.autocompleteEnabled,
              trigger: s.autocompleteTrigger,
              provider: p,
              modelId,
              apiKey: apiKeyRef.current,
              lmstudioBaseURL: s.lmstudioBaseURL,
              mlxBaseURL: s.mlxBaseURL,
              ollamaBaseURL: s.ollamaBaseURL,
              openaiCompatibleBaseURL:
                compatEp?.baseURL ?? s.openaiCompatibleBaseURL,
            };
          },
          getPath: () => pathRef.current,
          getLanguage: () => languageRef.current,
        }),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void performSaveRef.current();
              return true;
            },
          },
          { key: "Ctrl-g", run: gotoLine },
        ]),
      ],
      [],
    );

    useEffect(() => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: vimCompartment.reconfigure(vimMode ? Prec.highest(vim()) : []),
      });
    }, [vimMode]);

    useEffect(() => {
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: wrapCompartment.reconfigure(wordWrapExtension(wordWrapColumn)),
      });
    }, [wordWrapColumn]);

    useEffect(() => {
      if (doc.status !== "ready") return;
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: indentCompartment.reconfigure(
          indentExtension(detectIndentUnit(doc.content)),
        ),
      });
    }, [doc]);

    const lspExt = useLspExtension(path, langId, doc.status === "ready");
    useEffect(() => {
      lspActiveRef.current = lspExt !== null;
      const view = cmRef.current?.view;
      if (!view) return;
      view.dispatch({
        effects: lspCompartment.reconfigure(lspExt ?? []),
      });
    }, [lspExt]);
    useEffect(() => {
      searchJumpAllowedRef.current =
        jumpStrategy === "search" ||
        (jumpStrategy === "auto" && lspExt === null);
    }, [jumpStrategy, lspExt]);

    useEffect(
      () => () => useDiagnosticsStore.getState().report(pathRef.current, null),
      [],
    );

    // Warm the language chunk while the file is still being read; the
    // ready-gated effect below then resolves from cache.
    useEffect(() => {
      const resolvePath = overrideLanguage ? `dummy.${overrideLanguage}` : path;
      void resolveLanguage(resolvePath).catch(() => {});
    }, [path, overrideLanguage]);

    useEffect(() => {
      const ext =
        overrideLanguage || (path.split(".").pop()?.toLowerCase() ?? null);
      languageRef.current = ext;
      if (doc.status !== "ready") return;
      if (doc.size > SYNTAX_MAX_BYTES) {
        setLangId(null);
        const view = cmRef.current?.view;
        view?.dispatch({ effects: languageCompartment.reconfigure([]) });
        return;
      }
      let cancelled = false;
      const resolve = async (): Promise<LanguageResult> => {
        const resolvePath = overrideLanguage
          ? `dummy.${overrideLanguage}`
          : path;
        return (
          (await resolveLanguage(resolvePath)) ?? { ext: [], name: "", id: "" }
        );
      };
      void resolve().then((result) => {
        if (cancelled) return;
        if (result.id) languageRef.current = result.id;
        setLangId(result.id || ext);
        const view = cmRef.current?.view;
        if (!view) return;
        view.dispatch({
          effects: languageCompartment.reconfigure(result.ext),
        });
      });
      return () => {
        cancelled = true;
      };
    }, [path, doc.status, overrideLanguage]);

    useImperativeHandle(
      ref,
      () => ({
        searchStatus: (q: string) => {
          const view = cmRef.current?.view;
          if (!view || !q) return { index: 0, total: 0 };
          const query = new SearchQuery({ search: q, caseSensitive: false });
          if (!query.valid) return { index: 0, total: 0 };
          const head = view.state.selection.main.from;
          let total = 0;
          let index = 0;
          const cursor = query.getCursor(view.state);
          for (let it = cursor.next(); !it.done; it = cursor.next()) {
            total += 1;
            // 光标落在某个命中里或它前面 —— 那个就是"当前第几个"
            if (index === 0 && it.value.to >= head) index = total;
          }
          return { index: index || (total ? 1 : 0), total };
        },
        setQuery: (q: string) => {
          const view = cmRef.current?.view;
          if (!view) return;
          view.dispatch({
            effects: setSearchQuery.of(
              new SearchQuery({ search: q, caseSensitive: false }),
            ),
          });
          if (q) findNext(view);
        },
        findNext: () => {
          const view = cmRef.current?.view;
          if (view) findNext(view);
        },
        findPrevious: () => {
          const view = cmRef.current?.view;
          if (view) findPrevious(view);
        },
        clearQuery: () => {
          const view = cmRef.current?.view;
          if (!view) return;
          view.dispatch({
            effects: setSearchQuery.of(new SearchQuery({ search: "" })),
          });
        },
        openSearch: () => {
          const view = cmRef.current?.view;
          if (view) openSearchPanel(view);
        },
        focus: () => {
          pendingFocusRef.current = path;
          applyPendingFocus();
        },
        getSelection: () => {
          const view = cmRef.current?.view;
          if (!view) return null;
          const { from, to } = view.state.selection.main;
          if (from === to) return null;
          return view.state.sliceDoc(from, to);
        },
        getPath: () => path,
        reload: () => reloadRef.current(),
        gotoLine: (line: number, options) => {
          pendingLineRef.current = {
            path,
            line,
            focus: options?.focus ?? true,
          };
          applyPendingGoto();
        },
        undo: () => {
          const view = cmRef.current?.view;
          if (view) undo(view);
        },
        redo: () => {
          const view = cmRef.current?.view;
          if (view) redo(view);
        },
        triggerAiComplete: () => {
          const view = cmRef.current?.view;
          if (view) triggerInlineCompletion(view);
        },
        triggerCodeComplete: () => {
          const view = cmRef.current?.view;
          if (!view) return;
          view.focus();
          startCompletion(view);
        },
      }),
      [path, applyPendingFocus, applyPendingGoto],
    );

    if (doc.status === "loading") {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Loading…
        </div>
      );
    }
    if (doc.status === "error") {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-xs text-destructive">
          {doc.message}
        </div>
      );
    }
    if (doc.status === "binary" || doc.status === "toolarge") {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const isImage = [
        "png",
        "jpg",
        "jpeg",
        "gif",
        "webp",
        "svg",
        "ico",
      ].includes(ext);
      const isVideo = ["mp4", "webm", "ogg", "mov"].includes(ext);
      const isAudio = ["mp3", "wav", "flac", "aac", "m4a"].includes(ext);
      const isPdf = ext === "pdf";

      if (isImage || isVideo || isAudio || isPdf) {
        const assetUrl = convertFileSrc(path);
        return (
          <div className="flex h-full min-h-0 flex-col items-center justify-center bg-background p-4 overflow-auto">
            {isImage && (
              <img
                src={assetUrl}
                loading="lazy"
                decoding="async"
                className="max-w-full max-h-full object-contain rounded-md border border-border shadow-sm"
                style={{
                  backgroundImage:
                    "conic-gradient(var(--muted) 0.25turn, transparent 0.25turn 0.5turn, var(--muted) 0.5turn 0.75turn, transparent 0.75turn)",
                  backgroundSize: "20px 20px",
                }}
                alt={path.split("/").pop()}
              />
            )}
            {isVideo && (
              // biome-ignore lint/a11y/useMediaCaption: local media preview opens arbitrary files with no caption track
              <video
                controls
                preload="metadata"
                className="max-w-full max-h-full"
                src={assetUrl}
              />
            )}
            {isAudio && (
              // biome-ignore lint/a11y/useMediaCaption: local media preview opens arbitrary files with no caption track
              <audio
                controls
                preload="metadata"
                className="w-full max-w-md"
                src={assetUrl}
              />
            )}
            {isPdf && (
              <iframe
                src={assetUrl}
                className="w-full h-full border-none"
                title={path.split("/").pop()}
              />
            )}
          </div>
        );
      }

      const canForce =
        doc.status === "toolarge" && doc.size <= FORCE_READ_LIMIT;
      return (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
          <div className="text-sm text-foreground">
            {doc.status === "binary" ? "Binary file" : "File too large"}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatBytes(doc.size)} ·{" "}
            {canForce ? "syntax features disabled" : "preview not supported"}
          </div>
          {canForce && (
            <button
              type="button"
              onClick={openAnyway}
              className="mt-2 rounded-md border border-border bg-muted/60 px-3 py-1 text-xs text-foreground hover:bg-accent"
            >
              Open anyway
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col zoom-exempt">
        <CodeMirror
          ref={cmRef}
          value={doc.content}
          onChange={onChange}
          theme={themeExt}
          extensions={extensions}
          height="100%"
          className="flex-1 min-h-0 overflow-hidden"
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            foldGutter: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            searchKeymap: true,
          }}
        />
      </div>
    );
  }),
);
