import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkitem } from "./codeupApi";

const nativeMock = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock("@/modules/ai/lib/native", () => ({ native: nativeMock }));

function reply(body: unknown, status = 200) {
  nativeMock.runCommand.mockResolvedValue({
    stdout: `${JSON.stringify(body)}\n__HTTP_${status}__\n__TOTAL___`,
    stderr: "",
    exit_code: 0,
    timed_out: false,
    truncated: false,
  });
}

/** 按实测 GET workitems/{id} 的返回裁剪出来的样本。 */
const RAW = {
  id: "678d841c62aecb21254f2de116",
  subject: "套餐优化",
  description: '<article class="4ever-article"><p>说明</p></article>',
  formatType: "RICHTEXT",
  categoryId: "Req",
  parentId: null,
  serialNumber: "YOEZ-402",
  status: { displayName: "待处理", id: "100005", name: "待处理" },
  workitemType: { id: "9uy29901re573f561d69jn40", name: "产品类需求" },
  assignedTo: { id: "62c6", name: "施新华" },
  creator: { id: "62c6", name: "施新华" },
  space: { id: "3e7b6cd8343fd2053ec0aa7d8f", name: "腾云标准版" },
  customFieldValues: [
    {
      fieldFormat: "list",
      fieldId: "priority",
      fieldName: "优先级",
      values: [{ displayValue: "中", identifier: "3da4" }],
    },
  ],
};

describe("getWorkitem", () => {
  beforeEach(() => nativeMock.runCommand.mockReset());

  it("fetches one workitem by serial number and keeps the body fields", async () => {
    reply(RAW);
    const d = await getWorkitem("org1", "tok", "YOEZ-402");
    const cmd = String(nativeMock.runCommand.mock.calls[0][0]);
    expect(cmd).toContain("'GET'");
    expect(cmd).toContain(
      "'https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/org1/workitems/YOEZ-402'",
    );
    expect(d).toMatchObject({
      id: "678d841c62aecb21254f2de116",
      serialNumber: "YOEZ-402",
      subject: "套餐优化",
      statusName: "待处理",
      assignedTo: "施新华",
      description: '<article class="4ever-article"><p>说明</p></article>',
      formatType: "RICHTEXT",
      parentId: "",
      workitemTypeId: "9uy29901re573f561d69jn40",
      workitemTypeName: "产品类需求",
      categoryId: "Req",
      spaceId: "3e7b6cd8343fd2053ec0aa7d8f",
      spaceName: "腾云标准版",
    });
  });

  it("unwraps {result} and treats the list-style EMPTY_VALUE as no parent", async () => {
    reply({ result: { ...RAW, parentId: "EMPTY_VALUE" } });
    expect((await getWorkitem("org1", "tok", RAW.id)).parentId).toBe("");

    reply({ ...RAW, parentId: "a1b2c3", categoryId: "Task" });
    const task = await getWorkitem("org1", "tok", RAW.id);
    expect(task.parentId).toBe("a1b2c3");
    expect(task.categoryId).toBe("Task");
  });

  it("defaults fields the response leaves out", async () => {
    reply({ id: "x1", subject: "无描述" });
    expect(await getWorkitem("org1", "tok", "x1")).toMatchObject({
      description: "",
      formatType: "",
      parentId: "",
      workitemTypeId: "",
      spaceId: "",
      spaceName: "",
    });
  });

  it("url-encodes the identifier", async () => {
    reply(RAW);
    await getWorkitem("org1", "tok", " a/b ");
    expect(String(nativeMock.runCommand.mock.calls[0][0])).toContain(
      "/workitems/a%2Fb'",
    );
  });

  it("throws when the response is not a workitem or the call fails", async () => {
    reply({});
    await expect(getWorkitem("org1", "tok", "YOEZ-1")).rejects.toThrow(
      "YOEZ-1",
    );
    reply({ errorMessage: "工作项不存在" }, 404);
    await expect(getWorkitem("org1", "tok", "YOEZ-1")).rejects.toThrow(
      "云效接口报错(404):工作项不存在",
    );
  });
});
