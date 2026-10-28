import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchCodeupGroups } from "@/modules/android-run/lib/codeupGroupSearch";

const api = vi.hoisted(() => ({ searchNamespaces: vi.fn() }));
vi.mock("@/modules/android-run/lib/codeupApi", () => api);

beforeEach(() => {
  api.searchNamespaces.mockReset();
});

describe("代码组选择搜索", () => {
  it("中文和拼音搜索合并去重,仅保留配置根组及其子组", async () => {
    api.searchNamespaces.mockResolvedValue([
      {
        id: 1,
        name: "device2.0",
        pathWithNamespace: "org/device2.0",
        description: "",
      },
      {
        id: 2,
        name: "nanjinghangkong",
        pathWithNamespace: "org/device2.0/nanjinghangkong",
        description: "南京航空",
      },
      {
        id: 3,
        name: "other",
        pathWithNamespace: "device2.01/other",
        description: "",
      },
      {
        id: 4,
        name: "outside",
        pathWithNamespace: "other/group",
        description: "",
      },
    ]);
    const groups = await searchCodeupGroups(
      "org",
      "token",
      "南京航空",
      "org/device2.0/",
    );
    expect(groups.map((g) => g.pathWithNamespace)).toEqual([
      "device2.0",
      "device2.0/nanjinghangkong",
    ]);
    expect(api.searchNamespaces.mock.calls.map((call) => call[2])).toEqual([
      "南京航空",
      "nanjinghangkong",
      "nan_jing_hang_kong",
    ]);
  });

  it("一个搜索写法失败不丢弃其他成功结果", async () => {
    api.searchNamespaces.mockImplementation(
      async (_org: string, _token: string, query: string) => {
        if (query === "南京") throw new Error("接口失败");
        return [
          {
            id: 2,
            name: "nanjing",
            pathWithNamespace: "device2.0/nanjing",
            description: "南京",
          },
        ];
      },
    );
    expect(
      await searchCodeupGroups("org", "token", "南京", "device2.0"),
    ).toHaveLength(1);
  });

  it("全部失败时报告错误,不把请求失败展示成没有代码组", async () => {
    api.searchNamespaces.mockRejectedValue(new Error("权限不足"));
    await expect(
      searchCodeupGroups("org", "token", "南京", "device2.0"),
    ).rejects.toThrow("权限不足");
  });

  it("空查询不请求接口", async () => {
    expect(await searchCodeupGroups("org", "token", "  ", "device2.0")).toEqual(
      [],
    );
    expect(api.searchNamespaces).not.toHaveBeenCalled();
  });
});
