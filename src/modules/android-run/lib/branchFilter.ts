import { toPinyin } from "@/lib/pinyin";

export type BranchSearchKey = {
  name: string;
  /** 全拼,中文按字连起来:内蒙古 → neimenggu */
  full: string;
  /** 首字母:内蒙古 → nmg(非中文段取第一个字符) */
  initials: string;
};

/** 每个分支名只算一次拼音,别跟着每次按键重算。 */
export function branchSearchKey(name: string): BranchSearchKey {
  const lower = name.toLowerCase();
  return {
    name: lower,
    full: toPinyin(name, "").toLowerCase(),
    initials: toPinyin(name, " ")
      .toLowerCase()
      .split(" ")
      .map((p) => p[0] ?? "")
      .join(""),
  };
}

/**
 * 分支名里中文英文混着(`dz_内蒙古电力_宝宝取餐柜`),查询词三种写法都认:
 * 原文子串、全拼子串、拼音首字母子串。空查询全部命中。
 */
export function matchesBranchQuery(
  key: BranchSearchKey,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (key.name.includes(q)) return true;
  const qFull = toPinyin(q, "").toLowerCase();
  return key.full.includes(qFull) || key.initials.includes(q);
}
