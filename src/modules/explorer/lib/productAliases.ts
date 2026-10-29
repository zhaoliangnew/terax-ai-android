import { create } from "zustand";

/**
 * 产品的中文名:app_bind 这种英文名一长串看不出是啥,显示成"取盘机 app_bind"。
 * 按产品文件夹名记(各客户目录下的 app_bind 都是取盘机),存本地,可以在
 * 悬停弹层里点铅笔改。
 */
const KEY = "terax.explorer.productAliases";

/**
 * 默认的中文名:多数取自各工程 strings.xml 的 app_name,写的是"模块""百度语音
 * 示例"这类不像产品名的,按名字判断补的。用户改过的以用户为准。
 */
export const DEFAULT_PRODUCT_ALIASES: Record<string, string> = {
  app_add_food: "加菜机",
  app_ai_cheng: "智能秤",
  app_ai_cheng_new: "智能秤(新)",
  app_ai_hnswlib_demo: "货品识别示例",
  app_all_out_food: "批量出品机",
  app_bind: "取盘机",
  app_bind_alipay: "取盘机(支付宝)",
  app_cheng: "智能秤(旧)",
  app_dining_cabinet: "取餐柜",
  app_dinner_write: "餐具写入器",
  app_factory: "添加设备工具",
  app_food_safe_gateway: "食安网关",
  app_food_safe_guard_alarm: "食安报警器",
  app_fresh_cabinet: "生鲜柜",
  app_kitchen_gateway: "厨房网关",
  app_out_food: "出品机",
  app_price_tag: "价签",
  app_print_gateway: "打印网关",
  app_rice_army: "米面柜",
  app_sdk_demo: "SDK 测试",
  app_sdk_demo_third: "开放 Demo",
  app_self_device: "自助机",
  app_self_ordering: "自助点餐",
  app_super: "智慧收银",
  "framwork2.0": "公共框架",
  leniu_face: "人脸库",
  leniu_face_3288: "人脸库 3288",
  "leniu-k12-gua-android": "智慧收银 K12",
};

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    const map = raw ? JSON.parse(raw) : {};
    return map && typeof map === "object" && !Array.isArray(map) ? map : {};
  } catch {
    return {};
  }
}

type State = {
  /** 用户改过的(空串 = 不要中文名)。 */
  overrides: Record<string, string>;
  setAlias: (name: string, alias: string) => void;
};

export const useProductAliases = create<State>((set, get) => ({
  overrides: load(),
  setAlias: (name, alias) => {
    const overrides = { ...get().overrides, [name]: alias.trim() };
    try {
      localStorage.setItem(KEY, JSON.stringify(overrides));
    } catch {
      // 存不下就只在这次会话里生效
    }
    set({ overrides });
  },
}));

/** 产品的中文名;没有就是 null。name 是产品文件夹名(app_bind)。 */
export function productAlias(
  overrides: Record<string, string>,
  name: string,
): string | null {
  const v = name in overrides ? overrides[name] : DEFAULT_PRODUCT_ALIASES[name];
  return v ? v : null;
}

/** 组件里用:跟着用户的修改刷新。 */
export function useProductAlias(name: string): string | null {
  const overrides = useProductAliases((s) => s.overrides);
  return productAlias(overrides, name);
}
