import type { ModelOption } from "../store/claudeChatStore";

/** claude-opus-5-5[1m] → Opus 5.5 1M;不是 Claude 的 id 原样返回。 */
export function modelIdName(id: string): string {
  if (!id.startsWith("claude-")) return id;
  const name = id
    .replace(/^claude-/, "")
    .replace(/\[1m\]$/, " 1M")
    .replace(/-(\d+)-(\d+)/, " $1.$2")
    .replace(/-(\d+)$/, " $1");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * 会话报上来的模型 id 对应菜单里哪一项。不能按前缀认:claude-opus-5-5
 * 以 claude-opus-5 开头,会认成 Opus 5。只认完全相同、带 [1m] 这类后缀,
 * 或者 id 读出来的名字和菜单项名字一样(opus 别名 → claude-opus-5-5)。
 */
export function findModel(
  model: string,
  models: readonly ModelOption[],
): ModelOption | undefined {
  const exact = models.find((m) => m.value === model);
  if (exact) return exact;
  const suffixed = models.find((m) => model.startsWith(`${m.value}[`));
  if (suffixed) return suffixed;
  const name = modelIdName(model);
  return models.find((m) => m.value !== "default" && m.displayName === name);
}
