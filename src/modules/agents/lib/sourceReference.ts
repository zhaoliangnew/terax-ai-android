export type SourceReference = { path: string; line: number };

export function sourceReference(input: string): SourceReference | null {
  let value = input.trim();
  if (value.startsWith("file://")) {
    try {
      const url = new URL(value);
      if (url.hostname && url.hostname !== "localhost") return null;
      value = decodeURIComponent(url.pathname) + url.hash;
      if (/^\/[a-z]:\//i.test(value)) value = value.slice(1);
    } catch {
      return null;
    }
  } else {
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  const match = value.match(
    /^(.*?)(?::(\d+)(?::\d+)?(?:-\d+)?|#L(\d+)(?:C\d+)?(?:-L?\d+)?)$/i,
  );
  const path = (match?.[1] ?? value).replace(/\\/g, "/");
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:\//i.test(path)) return null;
  const line = Number(match?.[2] ?? match?.[3] ?? 1);
  if (
    !Number.isSafeInteger(line) ||
    line < 1 ||
    !/\.[a-z\d]+$/i.test(path) ||
    /[\n\r\0?#=<>"|]/.test(path) ||
    (!match && /\.html?$/i.test(path))
  )
    return null;
  return { path, line };
}

export function sourceMatches(paths: string[], reference: string): string[] {
  const suffix = reference.replace(/\\/g, "/").replace(/^\.\//, "");
  return paths.filter((path) => {
    const normalized = path.replace(/\\/g, "/");
    return normalized === suffix || normalized.endsWith(`/${suffix}`);
  });
}
