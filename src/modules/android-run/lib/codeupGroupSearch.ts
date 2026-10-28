import { searchVariants } from "@/lib/pinyin";
import {
  type CodeupNamespace,
  searchNamespaces,
} from "@/modules/android-run/lib/codeupApi";

export function relativeGroupPath(path: string, orgId: string): string {
  return path.startsWith(`${orgId}/`) ? path.slice(orgId.length + 1) : path;
}

export async function searchCodeupGroups(
  orgId: string,
  token: string,
  query: string,
  rootPath: string,
): Promise<CodeupNamespace[]> {
  const results = await Promise.allSettled(
    searchVariants(query).map((q) => searchNamespaces(orgId, token, q)),
  );
  const successful = results.filter((r) => r.status === "fulfilled");
  if (results.length && !successful.length) {
    const failed = results.find((r) => r.status === "rejected");
    throw failed?.reason ?? new Error("代码组搜索失败");
  }
  const root = relativeGroupPath(rootPath, orgId).replace(/\/+$/, "");
  const seen = new Set<number>();
  return successful
    .flatMap((r) => r.value)
    .filter((g) => {
      const path = relativeGroupPath(g.pathWithNamespace, orgId);
      if (seen.has(g.id) || (path !== root && !path.startsWith(`${root}/`)))
        return false;
      seen.add(g.id);
      return true;
    })
    .map((g) => ({
      ...g,
      pathWithNamespace: relativeGroupPath(g.pathWithNamespace, orgId),
    }));
}
