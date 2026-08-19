import { useEffect, useState } from "react";
import { scrcpyListDisplays } from "./lib/scrcpy";
import { ScreenMirror } from "./ScreenMirror";

type Props = {
  serial: string;
  /** Hidden mirrors keep decoding in the background so switching back is instant. */
  visible: boolean;
};

/**
 * One physical device's mirror (main + any secondary displays). Kept mounted
 * while any product mirrors this serial, so tab/product switches never drop the
 * scrcpy connection — only visibility toggles.
 */
export function DeviceMirror({ serial, visible }: Props) {
  const [displays, setDisplays] = useState<number[]>([0]);
  useEffect(() => {
    let cancelled = false;
    void scrcpyListDisplays(serial)
      .then((ids) => {
        if (!cancelled) setDisplays(ids.length ? ids : [0]);
      })
      .catch(() => {
        if (!cancelled) setDisplays([0]);
      });
    return () => {
      cancelled = true;
    };
  }, [serial]);

  return (
    <div
      className={`absolute inset-0 flex min-h-0${visible ? "" : " invisible pointer-events-none"}`}
    >
      {displays.map((did) => (
        <div
          key={did}
          className="min-w-0 flex-1 border-r border-border last:border-r-0"
        >
          <ScreenMirror
            serial={serial}
            displayId={did}
            label={
              displays.length > 1
                ? did === 0
                  ? "主屏"
                  : `副屏 (display ${did})`
                : undefined
            }
          />
        </div>
      ))}
    </div>
  );
}
