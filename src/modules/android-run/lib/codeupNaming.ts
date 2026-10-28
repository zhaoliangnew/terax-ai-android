import { toPinyin } from "@/lib/pinyin";

export function projectGroupSlug(projectName: string): string {
  return toPinyin(projectName, "").replace(/[^a-z0-9]/g, "");
}
