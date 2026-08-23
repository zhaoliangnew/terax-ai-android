import type { QuickLink } from "./quickLinks";

/**
 * 「嵌入式组知识库」根目录的固定入口,用钉钉 `dws wiki node list` 导出。
 * 内置成默认值,新机器装上就能用;用户仍可在菜单里增删改排序 —— 一旦本地
 * 存过自定义列表,这里就不再覆盖它。
 *
 * 知识库 workspaceId: oJRz0LwZOvKjAzLZ
 * 重新导出:
 *   dws wiki node list --workspace oJRz0LwZOvKjAzLZ --limit 50 -f json
 */
export const KNOWLEDGE_BASE_LINKS: QuickLink[] = [
  {
    id: "kb-6LeBq413JArGkMr1i34BaZ548DOnGvpb",
    title: "无线传感器产品",
    url: "https://alidocs.dingtalk.com/i/nodes/6LeBq413JArGkMr1i34BaZ548DOnGvpb",
    kind: "folder",
  },
  {
    id: "kb-lyQod3RxJKpmRxpBi4n3mb5A8kb4Mw9r",
    title: "设备接口地址整理，截止2026-05-13",
    url: "https://alidocs.dingtalk.com/i/nodes/lyQod3RxJKpmRxpBi4n3mb5A8kb4Mw9r",
    kind: "doc",
  },
  {
    id: "kb-4lgGw3P8vRG9dEyKCqM00DMy85daZ90D",
    title: "流量统计",
    url: "https://alidocs.dingtalk.com/i/nodes/4lgGw3P8vRG9dEyKCqM00DMy85daZ90D",
    kind: "doc",
  },
  {
    id: "kb-AR4GpnMqJzwLq6weigxoqZdK8Ke0xjE3",
    title: "嵌入式组开发分工",
    url: "https://alidocs.dingtalk.com/i/nodes/AR4GpnMqJzwLq6weigxoqZdK8Ke0xjE3",
    kind: "doc",
  },
  {
    id: "kb-KGZLxjv9VGjRa2jBiYlgGRd4W6EDybno",
    title: "硬件对接及文档（小牛对接三方）",
    url: "https://alidocs.dingtalk.com/i/nodes/KGZLxjv9VGjRa2jBiYlgGRd4W6EDybno",
    kind: "folder",
  },
  {
    id: "kb-93NwLYZXWyYl5LYqSdb6rGRnWkyEqBQm",
    title: "硬件sdk及文档（三方对接小牛）",
    url: "https://alidocs.dingtalk.com/i/nodes/93NwLYZXWyYl5LYqSdb6rGRnWkyEqBQm",
    kind: "folder",
  },
  {
    id: "kb-QG53mjyd805jw15BUlxXAo6nW6zbX04v",
    title: "嵌入式硬件",
    url: "https://alidocs.dingtalk.com/i/nodes/QG53mjyd805jw15BUlxXAo6nW6zbX04v",
    kind: "folder",
  },
  {
    id: "kb-20eMKjyp81wN5PwBiKgxOR3aVxAZB1Gv",
    title: "嵌入式安卓",
    url: "https://alidocs.dingtalk.com/i/nodes/20eMKjyp81wN5PwBiKgxOR3aVxAZB1Gv",
    kind: "folder",
  },
  {
    id: "kb-Y1OQX0akWmkgn0kqFEX7eZ7dJGlDd3mE",
    title: "银行合作硬件信息",
    url: "https://alidocs.dingtalk.com/i/nodes/Y1OQX0akWmkgn0kqFEX7eZ7dJGlDd3mE",
    kind: "doc",
  },
  {
    id: "kb-r1R7q3QmWe4MkB43sLPD6Kdq8xkXOEP2",
    title: "芯片数据结构",
    url: "https://alidocs.dingtalk.com/i/nodes/r1R7q3QmWe4MkB43sLPD6Kdq8xkXOEP2",
    kind: "doc",
  },
  {
    id: "kb-6LeBq413JArGkMr1iBXyy2b38DOnGvpb",
    title: "项目资料",
    url: "https://alidocs.dingtalk.com/i/nodes/6LeBq413JArGkMr1iBXyy2b38DOnGvpb",
    kind: "folder",
  },
  {
    id: "kb-P7QG4Yx2Jp2N0P2AcbwLvNyaW9dEq3XD",
    title: "供应商资料",
    url: "https://alidocs.dingtalk.com/i/nodes/P7QG4Yx2Jp2N0P2AcbwLvNyaW9dEq3XD",
    kind: "folder",
  },
  {
    id: "kb-amweZ92PV6wZAnwBigzlBkZlJxEKBD6p",
    title: "常用工具",
    url: "https://alidocs.dingtalk.com/i/nodes/amweZ92PV6wZAnwBigzlBkZlJxEKBD6p",
    kind: "folder",
  },
  {
    id: "kb-N7dx2rn0Jbl9M5l0u61RB7jqWMGjLRb3",
    title: "旷视人脸算法",
    url: "https://alidocs.dingtalk.com/i/nodes/N7dx2rn0Jbl9M5l0u61RB7jqWMGjLRb3",
    kind: "folder",
  },
  {
    id: "kb-gwva2dxOW4wpBaweiQM0G01x8bkz3BRL",
    title: "framwork2.0升级记录",
    url: "https://alidocs.dingtalk.com/i/nodes/gwva2dxOW4wpBaweiQM0G01x8bkz3BRL",
    kind: "doc",
  },
  {
    id: "kb-gwva2dxOW4wpBaweiBNXDqkd8bkz3BRL",
    title: "组内分享记录",
    url: "https://alidocs.dingtalk.com/i/nodes/gwva2dxOW4wpBaweiBNXDqkd8bkz3BRL",
    kind: "folder",
  },
  {
    id: "kb-NZQYprEoWoprRypBiqeNXlRPV1waOeDk",
    title: "离职同事移交资料",
    url: "https://alidocs.dingtalk.com/i/nodes/NZQYprEoWoprRypBiqeNXlRPV1waOeDk",
    kind: "folder",
  },
  {
    id: "kb-Obva6QBXJw0lPy0quQ3BdYDA8n4qY5Pr",
    title: "cursor",
    url: "https://alidocs.dingtalk.com/i/nodes/Obva6QBXJw0lPy0quQ3BdYDA8n4qY5Pr",
    kind: "folder",
  },
  {
    id: "kb-vy20BglGWOaO36a4T3y9l507JA7depqY",
    title: "嵌入式安卓（海康验厂资料）",
    url: "https://alidocs.dingtalk.com/i/nodes/vy20BglGWOaO36a4T3y9l507JA7depqY",
    kind: "folder",
  },
  {
    id: "kb-r1R7q3QmWe4MkB43sXlenl2n8xkXOEP2",
    title: "协作问题记录",
    url: "https://alidocs.dingtalk.com/i/nodes/r1R7q3QmWe4MkB43sXlenl2n8xkXOEP2",
    kind: "doc",
  },
];

export const KNOWLEDGE_BASE_HOME =
  "https://alidocs.dingtalk.com/i/spaces/oJRz0LwZOvKjAzLZ/overview";
