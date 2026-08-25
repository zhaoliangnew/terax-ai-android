export type AdbShellPlatform = "windows" | "unix";

function quoteExecutable(path: string, platform: AdbShellPlatform): string {
  if (platform === "windows") {
    return `'${path.replace(/'/g, "''")}'`;
  }
  return `'${path.replace(/'/g, "'\\''")}'`;
}

export function buildAdbCommand(
  executable: string,
  args: string,
  platform: AdbShellPlatform,
): string {
  const quoted = quoteExecutable(executable, platform);
  const invocation = platform === "windows" ? `& ${quoted}` : quoted;
  return args ? `${invocation} ${args}` : invocation;
}

export function buildAdbDiscoveryCommand(platform: AdbShellPlatform): string {
  if (platform === "windows") {
    return [
      "$candidates = @(",
      '"$env:ANDROID_HOME\\platform-tools\\adb.exe",',
      '"$env:ANDROID_SDK_ROOT\\platform-tools\\adb.exe",',
      '"$env:LOCALAPPDATA\\Android\\Sdk\\platform-tools\\adb.exe"',
      ");",
      "foreach ($c in $candidates) {",
      "if (Test-Path -LiteralPath $c -PathType Leaf) { Write-Output $c; exit 0 }",
      "};",
      "$cmd = Get-Command adb.exe -ErrorAction SilentlyContinue;",
      "if ($cmd) { Write-Output $cmd.Source }",
    ].join(" ");
  }

  return [
    "for c in",
    '"$ANDROID_HOME/platform-tools/adb"',
    '"$ANDROID_SDK_ROOT/platform-tools/adb"',
    '"$HOME/Library/Android/sdk/platform-tools/adb"',
    "/opt/homebrew/bin/adb",
    "/usr/local/bin/adb",
    "/usr/bin/adb",
    '; do [ -x "$c" ] && { printf %s "$c"; exit 0; }; done',
    "; command -v adb 2>/dev/null || true",
  ].join(" ");
}
