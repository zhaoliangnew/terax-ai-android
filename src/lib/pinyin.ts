import { pinyin } from "pinyin-pro";

/**
 * 中文转拼音。非中文字符原样保留,中文按字转、用 `sep` 连接。
 *
 * 用 pinyin-pro 的逐字 isZh 标记分段,而不是自己按 Unicode 区间转;
 * tiny-pinyin 靠 Intl.Collator 做字典二分查找,WebKit 的 ICU 排序跟
 * Node/V8 不一致,导致查找结果对不上 —— 很多常见字(比如"赵""组")
 * 转出来是空的。pinyin-pro 是直接查表,不依赖 Collator,才靠谱。
 */
export function toPinyin(raw: string, sep: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const tokens = pinyin(trimmed, { toneType: "none", type: "all" });
  const parts: string[] = [];
  let buf = "";
  const flush = () => {
    if (!buf) return;
    parts.push(buf.toLowerCase());
    buf = "";
  };
  for (const t of tokens) {
    if (t.isZh && t.pinyin) {
      flush();
      parts.push(t.pinyin.toLowerCase());
    } else {
      buf += t.origin;
    }
  }
  flush();
  return parts.join(sep);
}

export function hasChinese(raw: string): boolean {
  return /[一-鿿]/.test(raw);
}

/**
 * 一个搜索词该拿哪几种写法去问服务端。
 *
 * 云效上的组名/路径是拼音或英文(`beijingdianli`、`bei_jing_...`),而人脑子里
 * 想的是"北京"。所以中文查询额外带上两种拼音写法一起查,结果合并:
 * 分隔符不确定,连写和下划线都试,命中哪个算哪个。
 */
export function searchVariants(raw: string): string[] {
  const q = raw.trim();
  if (!q) return [];
  if (!hasChinese(q)) return [q];
  const out = [q];
  for (const sep of ["", "_"]) {
    const p = toPinyin(q, sep);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}
