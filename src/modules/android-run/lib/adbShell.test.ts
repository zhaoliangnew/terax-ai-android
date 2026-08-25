import { describe, expect, it } from "vitest";
import {
  buildAdbCommand,
  buildAdbDiscoveryCommand,
} from "@/modules/android-run/lib/adbShell";

describe("buildAdbCommand", () => {
  it("uses the PowerShell call operator for a Windows executable path", () => {
    expect(
      buildAdbCommand(
        "D:\\Android\\sdk\\platform-tools\\adb.exe",
        "connect 192.168.9.212:5555",
        "windows",
      ),
    ).toBe(
      "& 'D:\\Android\\sdk\\platform-tools\\adb.exe' connect 192.168.9.212:5555",
    );
  });

  it("escapes apostrophes in PowerShell executable paths", () => {
    expect(buildAdbCommand("C:\\SDK's\\adb.exe", "devices", "windows")).toBe(
      "& 'C:\\SDK''s\\adb.exe' devices",
    );
  });

  it("keeps POSIX executable invocation syntax", () => {
    expect(buildAdbCommand("/opt/android sdk/adb", "devices", "unix")).toBe(
      "'/opt/android sdk/adb' devices",
    );
  });
});

describe("buildAdbDiscoveryCommand", () => {
  it("uses PowerShell environment variables and command lookup on Windows", () => {
    const command = buildAdbDiscoveryCommand("windows");
    expect(command).toContain("$env:ANDROID_HOME");
    expect(command).toContain("Get-Command adb.exe");
  });

  it("uses POSIX command lookup on Unix", () => {
    const command = buildAdbDiscoveryCommand("unix");
    expect(command).toContain("$ANDROID_HOME/platform-tools/adb");
    expect(command).toContain("command -v adb");
  });
});
