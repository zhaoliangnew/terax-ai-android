import { localFileUrl } from "@/modules/html-preview/lib/localFileUrl";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 可点开看大图的缩略图:点小图铺满窗口看原图,点任意处或按 Esc 关。
 * 大图挂到 body 上,不受界面缩放和聊天区裁剪的影响。
 */
export function ImageThumb({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const name = path.split("/").pop();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  return (
    <>
      <button
        type="button"
        title="点击看大图"
        onClick={() => setOpen(true)}
        className="cursor-zoom-in"
      >
        <img src={localFileUrl(path)} alt={name} className={className} />
      </button>
      {open &&
        createPortal(
          <button
            type="button"
            aria-label="关闭大图"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[1000] flex cursor-zoom-out items-center justify-center bg-black/80 p-8"
          >
            <img
              src={localFileUrl(path)}
              alt={name}
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            />
          </button>,
          document.body,
        )}
    </>
  );
}
