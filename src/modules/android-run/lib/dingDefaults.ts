import type { DingEntry } from "./dingtalk";

/**
 * 分组怎么排成列。人少的几组叠在同一列里,不然每组各占一列、底下一大片空白,
 * 菜单还白白变宽;各列高度也尽量拉平。列表里没提到的分组(用户自己加的)另起一列。
 */
export const DING_COLUMNS: string[][] = [
  ["群", "运维", "前端"],
  ["安卓", "嵌入式"],
  ["测试"],
  ["新产品导入"],
  ["产品"],
  ["郑州后端"],
  ["南京后端"],
];

/**
 * 钉钉直达的内置清单:嵌入式开发组这个群 + 按工种分好的同事。
 *
 * 这份是**固定的**,界面上不给改不给删 —— 跟嵌入式组知识库那 20 条一个道理,
 * 它对应的是组织架构而不是个人偏好,人员变动应该重跑下面的命令更新代码,
 * 而不是各人在自己机器上删删改改。用户自己要加的走"自定义"那一栏。
 *
 * 安卓/嵌入式的划分来自钉钉通讯录里的职位(orgTitle),不是拍脑袋分的:
 * "安卓研发工程师" → 安卓,"嵌入式研发工程师/组长" → 嵌入式。
 *
 * 名单来源(人变了就重新跑一遍,把结果贴回来):
 *   dws contact +dept-members --dept 嵌入式研发组 -f json     # 拿名字和 userId
 *   dws contact user get --ids <userId> -f json              # 拿 orgTitle 分工种
 *   dws contact +dept-members --dept 研发部-测试组 -f json
 *   dws contact +dept-members --dept 产品组 -f json
 *   dws contact +dept-members --dept 运维组 -f json
 *   dws contact +dept-members --dept 前端研发组 -f json
 *   dws contact +dept-members --dept 南京后端研发组 -f json
 *   dws contact +dept-members --dept 郑州后端研发组 -f json
 *   dws contact +dept-members --dept 硬件研发组 -f json    # 界面上叫"新产品导入"
 *   dws contact +lookup --name 马勋 -f json
 *
 * 部门清单:dws contact +list-sub-depts --dept 14871200(研发部)
 *
 * 导出于 2026-08-23。
 */
export const DEFAULT_DING_ENTRIES: DingEntry[] = [
  { id: "d-group-embedded", name: "嵌入式开发组", kind: "group", team: "群" },

  // 赵亮和周俊杰通讯录职位挂的是嵌入式,实际做安卓 —— 以实际为准。
  { id: "d-android-zhaoliang", name: "赵亮", kind: "person", team: "安卓" },
  { id: "d-android-zhoujunjie", name: "周俊杰", kind: "person", team: "安卓" },
  { id: "d-android-zhuyakun", name: "朱雅堃", kind: "person", team: "安卓" },
  { id: "d-android-liminghui", name: "李明辉", kind: "person", team: "安卓" },
  { id: "d-android-jinqiankang", name: "金乾康", kind: "person", team: "安卓" },

  { id: "d-emb-zhangguangcan", name: "张广灿", kind: "person", team: "嵌入式" },
  { id: "d-emb-tudeming", name: "涂德明", kind: "person", team: "嵌入式" },
  { id: "d-emb-wuhaining", name: "吴海宁", kind: "person", team: "嵌入式" },
  { id: "d-emb-luohuiwen", name: "罗会文", kind: "person", team: "嵌入式" },
  { id: "d-emb-xietianchen", name: "谢添臣", kind: "person", team: "嵌入式" },
  { id: "d-emb-mazhixiang", name: "马智翔", kind: "person", team: "嵌入式" },
  { id: "d-emb-zhangrenkang", name: "张仁康", kind: "person", team: "嵌入式" },

  { id: "d-qa-jiazhonglong", name: "贾中龙", kind: "person", team: "测试" },
  { id: "d-qa-wangjie", name: "汪杰", kind: "person", team: "测试" },
  { id: "d-qa-liuheng", name: "刘亨", kind: "person", team: "测试" },
  { id: "d-qa-zhangguanglin", name: "张光临", kind: "person", team: "测试" },
  { id: "d-qa-guhaoran", name: "顾浩冉", kind: "person", team: "测试" },
  { id: "d-qa-hejingyang", name: "何京阳", kind: "person", team: "测试" },
  { id: "d-qa-zhangxin", name: "张欣", kind: "person", team: "测试" },
  { id: "d-qa-wangli", name: "王丽", kind: "person", team: "测试" },

  { id: "d-pm-shixinhua", name: "施新华", kind: "person", team: "产品" },
  { id: "d-pm-fangkai", name: "方凯", kind: "person", team: "产品" },
  { id: "d-pm-baijianhua", name: "白建华", kind: "person", team: "产品" },
  { id: "d-pm-xumi", name: "许咪", kind: "person", team: "产品" },
  { id: "d-pm-zhoujianhui", name: "周剑辉", kind: "person", team: "产品" },
  { id: "d-pm-yuanzhipeng", name: "袁志鹏", kind: "person", team: "产品" },
  { id: "d-pm-maohongpeng", name: "毛宏鹏", kind: "person", team: "产品" },
  { id: "d-pm-guanxin", name: "关新", kind: "person", team: "产品" },
  { id: "d-pm-guodingding", name: "郭叮叮", kind: "person", team: "产品" },

  { id: "d-ops-xupeng", name: "许鹏", kind: "person", team: "运维" },
  { id: "d-ops-fangxiao", name: "方潇", kind: "person", team: "运维" },

  { id: "d-fe-weixiaodong", name: "卫晓栋", kind: "person", team: "前端" },
  { id: "d-fe-huodaokai", name: "霍道凯", kind: "person", team: "前端" },
  { id: "d-fe-wangjiantao", name: "王建涛", kind: "person", team: "前端" },
  { id: "d-fe-xiayukun", name: "夏宇坤", kind: "person", team: "前端" },
  { id: "d-fe-weiyongjia", name: "卫永嘉", kind: "person", team: "前端" },

  {
    id: "d-benj-chenshenjie",
    name: "陈沈杰",
    kind: "person",
    team: "南京后端",
  },
  { id: "d-benj-guoyapeng", name: "郭亚鹏", kind: "person", team: "南京后端" },
  {
    id: "d-benj-lingxuheng",
    name: "凌徐衡",
    kind: "person",
    team: "南京后端",
  },
  { id: "d-benj-xujiajun", name: "徐嘉骏", kind: "person", team: "南京后端" },
  { id: "d-benj-yaojunze", name: "姚均泽", kind: "person", team: "南京后端" },
  { id: "d-benj-hepei", name: "何沛", kind: "person", team: "南京后端" },
  { id: "d-benj-guohaoyu", name: "郭昊宇", kind: "person", team: "南京后端" },
  {
    id: "d-benj-luoshengwei",
    name: "罗圣炜",
    kind: "person",
    team: "南京后端",
  },
  { id: "d-benj-qianyifan", name: "钱祎帆", kind: "person", team: "南京后端" },
  { id: "d-benj-liufei", name: "刘飞", kind: "person", team: "南京后端" },
  { id: "d-benj-wangxun", name: "王洵", kind: "person", team: "南京后端" },
  { id: "d-benj-lixiang", name: "李翔", kind: "person", team: "南京后端" },
  {
    id: "d-benj-zhaohaiyang",
    name: "赵海洋",
    kind: "person",
    team: "南京后端",
  },
  { id: "d-benj-caomin", name: "曹敏", kind: "person", team: "南京后端" },
  { id: "d-benj-tianweidi", name: "田蔚荻", kind: "person", team: "南京后端" },
  { id: "d-benj-xubo", name: "许博", kind: "person", team: "南京后端" },
  {
    id: "d-benj-zhangjunlong",
    name: "张俊龙",
    kind: "person",
    team: "南京后端",
  },

  { id: "d-hw-fanming", name: "范明", kind: "person", team: "新产品导入" },
  { id: "d-hw-yuanzepeng", name: "原泽鹏", kind: "person", team: "新产品导入" },
  {
    id: "d-hw-zhutianyuan",
    name: "朱田源",
    kind: "person",
    team: "新产品导入",
  },
  { id: "d-hw-zhuguolong", name: "朱国龙", kind: "person", team: "新产品导入" },
  { id: "d-hw-panchongyi", name: "潘崇义", kind: "person", team: "新产品导入" },
  { id: "d-hw-fenghong", name: "冯洪", kind: "person", team: "新产品导入" },
  { id: "d-hw-lishuai", name: "李帅", kind: "person", team: "新产品导入" },
  { id: "d-hw-yinlei", name: "殷磊", kind: "person", team: "新产品导入" },
  { id: "d-hw-zhaohao", name: "赵昊", kind: "person", team: "新产品导入" },
  { id: "d-hw-zhonghaoyu", name: "钟浩宇", kind: "person", team: "新产品导入" },

  { id: "d-bezz-lishihao", name: "李世豪", kind: "person", team: "郑州后端" },
  { id: "d-bezz-fanfuchen", name: "范付辰", kind: "person", team: "郑州后端" },
  { id: "d-bezz-pangfuyue", name: "庞福越", kind: "person", team: "郑州后端" },
  { id: "d-bezz-dingwenlei", name: "丁文磊", kind: "person", team: "郑州后端" },
  {
    id: "d-bezz-liubinqiang",
    name: "刘斌强",
    kind: "person",
    team: "郑州后端",
  },
  { id: "d-bezz-liuyang", name: "刘杨", kind: "person", team: "郑州后端" },
  { id: "d-bezz-liguorui", name: "李国瑞", kind: "person", team: "郑州后端" },
  { id: "d-bezz-lizhigang", name: "李志岗", kind: "person", team: "郑州后端" },
  { id: "d-bezz-wuhan", name: "毋涵", kind: "person", team: "郑州后端" },
  {
    id: "d-bezz-gaomenglong",
    name: "高梦龙",
    kind: "person",
    team: "郑州后端",
  },
];
