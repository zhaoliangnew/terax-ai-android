import { describe, expect, it } from "vitest";
import {
  factsNeeded,
  hasDeviceSupport,
  mayBeProjectDir,
  projectKindFromEntries,
} from "./projectKind";

const NO_FACTS = { flutter: false, ideaModules: false };
const kind = (names: string[], facts = NO_FACTS) =>
  projectKindFromEntries(new Set(names), facts);

describe("projectKindFromEntries", () => {
  it("recognizes common project markers", () => {
    expect(kind(["settings.gradle.kts", "app"])).toBe("android");
    expect(kind(["pom.xml", "src"])).toBe("maven");
    expect(kind(["App.xcodeproj"])).toBe("xcode");
    expect(kind(["Foo.sln"])).toBe("dotnet");
    expect(kind(["Cargo.toml"])).toBe("rust");
    expect(kind(["go.mod"])).toBe("go");
    expect(kind(["package.json"])).toBe("node");
    expect(kind(["requirements.txt"])).toBe("python");
    expect(kind(["composer.json"])).toBe("php");
    expect(kind(["Gemfile"])).toBe("ruby");
    expect(kind(["CMakeLists.txt"])).toBe("cmake");
  });

  it("prefers the more specific kind when markers overlap", () => {
    expect(
      kind(["pubspec.yaml", "android", "settings.gradle"], {
        flutter: true,
        ideaModules: false,
      }),
    ).toBe("flutter");
    expect(kind(["package.json", "src-tauri", "Cargo.toml"])).toBe("tauri");
    expect(
      kind([".idea", "settings.gradle"], { flutter: false, ideaModules: true }),
    ).toBe("android");
  });

  it("only treats .idea as a project when modules.xml exists", () => {
    expect(kind([".idea", "src"])).toBeNull();
    expect(
      kind([".idea", "src", "app.iml"], { flutter: false, ideaModules: true }),
    ).toBe("idea");
  });

  it("does not treat a plain dart package as flutter", () => {
    expect(kind(["pubspec.yaml", "lib"])).toBeNull();
  });

  it("returns null for plain folders", () => {
    expect(kind(["README.md", "docs"])).toBeNull();
  });
});

describe("factsNeeded", () => {
  it("asks for extra reads only when the marker exists", () => {
    expect(factsNeeded(new Set(["src"]))).toEqual({
      flutter: false,
      ideaModules: false,
    });
    expect(factsNeeded(new Set(["pubspec.yaml", ".idea"]))).toEqual({
      flutter: true,
      ideaModules: true,
    });
  });
});

describe("mayBeProjectDir", () => {
  it("skips build and dependency folders", () => {
    expect(mayBeProjectDir("/a/node_modules")).toBe(false);
    expect(mayBeProjectDir("/a/build/")).toBe(false);
    expect(mayBeProjectDir("/a/app")).toBe(true);
  });
});

describe("hasDeviceSupport", () => {
  it("is only for installable mobile projects", () => {
    expect(hasDeviceSupport("android")).toBe(true);
    expect(hasDeviceSupport("flutter")).toBe(true);
    expect(hasDeviceSupport("node")).toBe(false);
    expect(hasDeviceSupport(null)).toBe(false);
  });
});
