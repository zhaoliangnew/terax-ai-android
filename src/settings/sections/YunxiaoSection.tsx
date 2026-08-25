import { Button } from "@/components/ui/button";
import {
  getCodeupOrgId,
  getRootGroupPath,
  getYunxiaoToken,
  setCodeupOrgId,
  setRootGroupPath,
  setYunxiaoToken,
  TOKEN_HELP_URL,
} from "@/modules/android-run/lib/codeupApi";
import { openExternally } from "@/modules/android-run/lib/openExternally";
import { useState } from "react";
import { toast } from "sonner";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

const INPUT_CLASS =
  "h-8 w-72 rounded border border-input bg-transparent px-2 font-mono text-[12px] outline-none focus:border-ring";

/** 云效相关配置统一入口:令牌、组织 ID、仓库面板根分组。 */
export function YunxiaoSection() {
  const [token, setToken] = useState(() => getYunxiaoToken() ?? "");
  const [orgId, setOrgId] = useState(() => getCodeupOrgId() ?? "");
  const [rootGroup, setRootGroup] = useState(() => getRootGroupPath() ?? "");

  const saveAll = () => {
    setYunxiaoToken(token);
    setCodeupOrgId(orgId);
    setRootGroupPath(rootGroup);
    toast.success("云效配置已保存");
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="云效"
        description="云效 OpenAPI 相关配置:个人访问令牌、组织与仓库面板的根分组。仅保存在本机。"
      />

      <SettingRow
        title="个人访问令牌"
        description="调用云效接口的凭证,需要“代码管理”读写权限。"
      >
        <div className="flex items-center gap-1.5">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="pt-…"
            spellCheck={false}
            className={INPUT_CLASS}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => openExternally(TOKEN_HELP_URL)}
            className="h-8 shrink-0 text-xs"
          >
            去获取
          </Button>
        </div>
      </SettingRow>

      <SettingRow
        title="组织 ID"
        description="仓库地址里 codeup.aliyun.com: 后面的第一段;用过复制工程等功能后会自动记录。"
      >
        <input
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          placeholder="61dbcd…"
          spellCheck={false}
          className={INPUT_CLASS}
        />
      </SettingRow>

      <SettingRow
        title="仓库面板根分组"
        description="云效 Git 仓库面板从这个分组往下逐层展示。可直接粘贴分组网页地址。"
      >
        <input
          value={rootGroup}
          onChange={(e) => setRootGroup(e.target.value)}
          placeholder="https://codeup.aliyun.com/<组织>/device2.0"
          spellCheck={false}
          className={INPUT_CLASS}
        />
      </SettingRow>

      <div className="flex justify-end">
        <Button size="sm" onClick={saveAll} className="text-xs">
          保存
        </Button>
      </div>
    </div>
  );
}
