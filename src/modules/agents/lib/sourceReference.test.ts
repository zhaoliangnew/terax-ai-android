import { describe, expect, it } from "vitest";
import {
  sourceMatches,
  sourceReference,
} from "@/modules/agents/lib/sourceReference";

describe("source references", () => {
  it("reads file names, paths, lines, columns and ranges", () => {
    for (const value of [
      "DoorController.kt:107",
      "DoorController.kt:107:4",
      "DoorController.kt#L107-L110",
    ])
      expect(sourceReference(value)).toEqual({
        path: "DoorController.kt",
        line: 107,
      });
    expect(sourceReference("src/page-server.js:139")).toEqual({
      path: "src/page-server.js",
      line: 139,
    });
    expect(sourceReference("/project/main.kt")).toEqual({
      path: "/project/main.kt",
      line: 1,
    });
  });
  it("decodes local file links and Windows paths", () => {
    expect(sourceReference("file:///project/My%20File.kt#L3")).toEqual({
      path: "/project/My File.kt",
      line: 3,
    });
    expect(sourceReference("C:\\project\\main.kt:4")).toEqual({
      path: "C:/project/main.kt",
      line: 4,
    });
    expect(sourceReference("file:///C:/project/main.kt#L4")).toEqual({
      path: "C:/project/main.kt",
      line: 4,
    });
  });
  it("leaves websites, unsafe schemes, invalid lines and HTML previews alone", () => {
    for (const value of [
      "https://example.com/main.kt:3",
      "javascript:main.kt",
      "file://remote/main.kt",
      "main.kt:0",
      "main.kt:99999999999999999999",
      "main.kt?x",
      "index.html",
      "%invalid",
      "hello",
    ])
      expect(sourceReference(value)).toBeNull();
  });
  it("matches full path suffixes without choosing an ambiguous basename", () => {
    const paths = [
      "/project/a/Main.kt",
      "/project/b/Main.kt",
      "/project/a/OtherMain.kt",
    ];
    expect(sourceMatches(paths, "Main.kt")).toEqual(paths.slice(0, 2));
    expect(sourceMatches(paths, "./a/Main.kt")).toEqual([paths[0]]);
    expect(sourceMatches(paths, "missing/Main.kt")).toEqual([]);
  });
});
