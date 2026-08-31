/**
 * 右下角的版本号,内容就是编译时刻(`V20260831-1522`,见 vite.config.ts 的
 * define)。
 *
 * 这里以前显示的是当前时间 —— 但系统菜单栏上已经有一个钟了,右下角这块地方
 * 拿来标"你现在跑的是哪一次构建"更值:报问题、对崩溃日志、确认更新有没有生效,
 * 都靠它。package.json 里那个 0.0.1 从来没人改,指望不上。
 */
export function BuildStamp() {
  return (
    <span
      className="flex shrink-0 cursor-default items-center rounded-full bg-foreground/5 px-2 py-0.5 text-[10.5px] text-muted-foreground tabular-nums"
      title="当前运行的构建版本(编译时刻)"
    >
      {__BUILD_STAMP__}
    </span>
  );
}
