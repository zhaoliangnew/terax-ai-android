import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";

export function withoutRightPanel(layout: Record<string, number>) {
  return { ...layout, workspace: layout.workspace + layout.device, device: 0 };
}

/**
 * 窗口(按系统缩放折算后的)宽度不超过这个就把右栏收成右边缘的竖条。
 * 2048、1920 宽的外接屏三栏还摆得下,1600 及以下才挤。
 */
const FLYOUT_QUERY = "(max-width: 1600px)";

export function useRightFlyout(
  groupRef: RefObject<GroupImperativeHandle | null>,
) {
  const [floating, setFloating] = useState(
    () => window.matchMedia(FLYOUT_QUERY).matches,
  );
  const [open, setOpen] = useState(false);
  const desktopLayout = useRef<Record<string, number> | null>(null);

  useEffect(() => {
    const query = window.matchMedia(FLYOUT_QUERY);
    const update = () => setFloating(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    if (floating) {
      const layout = group.getLayout();
      if (!Number.isFinite(layout.workspace) || !Number.isFinite(layout.device))
        return;
      desktopLayout.current ??= layout;
      group.setLayout(withoutRightPanel(layout));
    } else if (desktopLayout.current) {
      group.setLayout(desktopLayout.current);
      desktopLayout.current = null;
      setOpen(false);
    }
  }, [floating, groupRef]);

  useEffect(() => {
    if (!floating || !open) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    const inside = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest(
        '[data-right-flyout], [data-right-rail], [role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]',
      );
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      if (
        inside(event.target) ||
        document.activeElement?.closest("[data-right-flyout]")
      ) {
        clear();
        return;
      }
      if (!timer) timer = setTimeout(() => setOpen(false), 250);
    };
    const down = (event: PointerEvent) => {
      clear();
      if (!inside(event.target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clear();
        setOpen(false);
      }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      clear();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [floating, open]);

  const reveal = useCallback(() => setOpen(true), []);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  return { floating, open, reveal, toggle };
}
