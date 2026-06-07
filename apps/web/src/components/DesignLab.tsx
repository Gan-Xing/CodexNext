"use client";

import { useState } from "react";

export type DesignState =
  | "empty"
  | "device"
  | "project"
  | "permission"
  | "model"
  | "typing"
  | "chat"
  | "running"
  | "approval";

export type DesignFlow =
  | "current"
  | "new-session"
  | "thread"
  | "approval-flow"
  | "device-flow"
  | "settings"
  | "components"
  | "archive";

const designStates: Array<{
  id: DesignState;
  label: string;
  description: string;
}> = [
  {
    id: "empty",
    label: "01 空白新会话",
    description: "普通入口只保留底部输入框，不显示 Goal / Token Budget。"
  },
  {
    id: "device",
    label: "02 选择设备",
    description: "设备是可编辑名称的 Codex Agent 目标，不是当前浏览器。"
  },
  {
    id: "project",
    label: "03 选择项目",
    description: "目录浏览选择 cwd，不要求用户手动输入路径。"
  },
  {
    id: "permission",
    label: "04 权限菜单",
    description: "四种 Codex 权限模式，贴近输入框的轻菜单。"
  },
  {
    id: "model",
    label: "05 模型与推理",
    description: "模型、推理深度、速度在一个菜单里完成选择。"
  },
  {
    id: "typing",
    label: "06 输入发送",
    description: "没有正在运行的任务时，上箭头会开启新一轮对话。"
  },
  {
    id: "chat",
    label: "07 聊天视图",
    description: "进入同一个对话后继续交流，事件融入消息流。"
  },
  {
    id: "running",
    label: "08 运行中追加",
    description: "正在运行时，输入框用于追加指令和调整方向。"
  },
  {
    id: "approval",
    label: "09 审批请求",
    description: "审批请求必须由用户处理，不再默认拒绝。"
  }
];

const designStateById = new Map(designStates.map((state) => [state.id, state]));

const designFlows: Array<{
  id: DesignFlow;
  href: string;
  label: string;
  description: string;
  defaultState: DesignState;
  states: DesignState[];
}> = [
  {
    id: "current",
    href: "/design",
    label: "当前主设计",
    description: "最新可执行的 CodexNext Web 控制台设计板。",
    defaultState: "empty",
    states: ["empty", "device", "project", "permission", "model", "typing", "chat", "running", "approval"]
  },
  {
    id: "new-session",
    href: "/design/new-session",
    label: "新会话流程",
    description: "新建对话、选择项目、模型、推理和权限。",
    defaultState: "empty",
    states: ["empty", "project", "permission", "model", "typing"]
  },
  {
    id: "thread",
    href: "/design/thread",
    label: "对话与运行中",
    description: "同一 thread 的聊天视图、running、steer 和 interrupt。",
    defaultState: "chat",
    states: ["chat", "running"]
  },
  {
    id: "approval-flow",
    href: "/design/approval",
    label: "审批请求",
    description: "命令/文件 approval request 的浏览器处理体验。",
    defaultState: "approval",
    states: ["approval"]
  },
  {
    id: "device-flow",
    href: "/design/device",
    label: "设备与项目",
    description: "设备命名、连接状态、项目文件夹选择入口。",
    defaultState: "device",
    states: ["device", "project"]
  },
  {
    id: "settings",
    href: "/design/settings",
    label: "设置与账户",
    description: "后续账户、设备、偏好设置的设计占位。",
    defaultState: "empty",
    states: ["empty", "device"]
  },
  {
    id: "components",
    href: "/design/components",
    label: "组件与图标",
    description: "Codex 风图标、按钮、菜单、pill 的共享样式库。",
    defaultState: "empty",
    states: ["empty", "permission", "model"]
  },
  {
    id: "archive",
    href: "/design/archive",
    label: "设计归档",
    description: "保存旧版本、Figma 截图和阶段性决策。",
    defaultState: "empty",
    states: ["empty"]
  }
];

const defaultDesignFlow = designFlows[0]!;

function getDesignFlow(flow: DesignFlow) {
  return designFlows.find((candidate) => candidate.id === flow) ?? defaultDesignFlow;
}

export type CodexIconName =
  | "arrowUp"
  | "back"
  | "check"
  | "chevronDown"
  | "chevronLeft"
  | "chevronRight"
  | "clock"
  | "collapse"
  | "compose"
  | "edit"
  | "forward"
  | "folder"
  | "hand"
  | "phone"
  | "more"
  | "plug"
  | "plus"
  | "search"
  | "settings"
  | "shield"
  | "shieldAlert"
  | "terminal"
  | "x";

const folders = [
  "Applications",
  "Desktop",
  "Dev",
  "Documents",
  "Downloads",
  "Pictures"
];

const projectTree = [
  {
    name: "dailywork",
    sessions: ["估算5月6月成本"]
  },
  {
    name: "Dev",
    sessions: [
      "CodexNext",
      "安装并启动 odysseus",
      "Gmail邮件",
      "拉取最新代码"
    ]
  },
  {
    name: "虚量合同",
    sessions: ["按文件内容重命名"]
  },
  {
    name: "翘楚弹幕",
    sessions: ["发送弹幕并记录时间"]
  },
  {
    name: "pi",
    sessions: ["了解 pi 用法"]
  },
  {
    name: "工程量处理",
    sessions: ["查找历史报价单资料", "按清单计算钢筋用量", "整理三项目人员并修改Word"]
  },
  {
    name: "Desktop",
    sessions: ["查找物资计划总表", "查询意大利旅游材料", "编写视频下载脚本"]
  },
  {
    name: "文件处理",
    sessions: ["同步最终提交版本", "检查材料统计表公式"]
  },
  {
    name: "月报",
    sessions: ["更新安全月活动方案", "生成第三周周报"]
  },
  {
    name: "账单签收件_12个PDF_2026-06",
    sessions: ["找出缺少签收的文件"]
  }
];

export function CodexIcon(props: { name: CodexIconName; className?: string }) {
  const className = ["cn-codex-icon", props.className].filter(Boolean).join(" ");

  if (props.name === "folder") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 20 20">
        <path
          d="M16.6182 9.33203H3.38184V12.7002C3.38184 13.3753 3.38238 13.8438 3.41211 14.208C3.44124 14.5646 3.49494 14.766 3.57129 14.916L3.63867 15.0361C3.80618 15.3094 4.04683 15.5324 4.33399 15.6787L4.45703 15.7314C4.59362 15.7803 4.77411 15.816 5.04199 15.8379C5.40624 15.8676 5.87469 15.8682 6.54981 15.8682H13.4502C14.1253 15.8682 14.5938 15.8676 14.958 15.8379C15.3146 15.8088 15.516 15.7551 15.666 15.6787L15.7861 15.6113C16.0594 15.4438 16.2824 15.2032 16.4287 14.916L16.4814 14.793C16.5303 14.6564 16.566 14.4759 16.5879 14.208C16.6176 13.8438 16.6182 13.3753 16.6182 12.7002V9.33203ZM17.8818 12.7002C17.8818 13.3547 17.8826 13.8838 17.8477 14.3115C17.8165 14.6922 17.7543 15.0349 17.6172 15.3545L17.5537 15.4902C17.3015 15.9852 16.9182 16.3996 16.4473 16.6885L16.2402 16.8037C15.8824 16.9861 15.4966 17.0621 15.0615 17.0977C14.6338 17.1326 14.1047 17.1318 13.4502 17.1318H6.54981C5.89526 17.1318 5.36616 17.1326 4.93848 17.0977C4.55777 17.0665 4.21506 17.0043 3.89551 16.8672L3.75977 16.8037C3.26483 16.5515 2.85036 16.1682 2.56152 15.6973L2.44629 15.4902C2.26394 15.1324 2.1879 14.7466 2.15235 14.3115C2.1174 13.8838 2.11817 13.3547 2.11817 12.7002V7.29981C2.11817 6.64526 2.1174 6.11616 2.15235 5.68848C2.1879 5.25344 2.26394 4.86765 2.44629 4.50977L2.56152 4.30274C2.85036 3.83179 3.26483 3.44854 3.75977 3.19629L3.89551 3.13281C4.21506 2.99571 4.55777 2.93346 4.93848 2.90235C5.36616 2.8674 5.89526 2.86817 6.54981 2.86817H7.24512C7.38876 2.86816 7.48717 2.86807 7.58399 2.87402L7.83496 2.90039C8.41501 2.98537 8.96006 3.23832 9.40039 3.63086L9.64356 3.86817C9.75546 3.98103 9.79343 4.0181 9.83008 4.05078L9.94238 4.14356C10.2142 4.34787 10.5413 4.46917 10.8828 4.49024L11.1445 4.49317H13.4502C14.1047 4.49317 14.6338 4.4924 15.0615 4.52735C15.4966 4.5629 15.8824 4.63894 16.2402 4.82129L16.4473 4.93652C16.9182 5.22536 17.3015 5.63983 17.5537 6.13477L17.6172 6.27051C17.7543 6.59006 17.8165 6.93277 17.8477 7.31348C17.8826 7.74116 17.8818 8.27026 17.8818 8.92481V12.7002ZM3.38184 8.06836H16.6143C16.6105 7.81516 16.603 7.60256 16.5879 7.41699C16.566 7.14911 16.5303 6.96862 16.4814 6.83203L16.4287 6.70899C16.2824 6.42183 16.0594 6.18118 15.7861 6.01367L15.666 5.94629C15.516 5.86994 15.3146 5.81624 14.958 5.78711C14.5938 5.75738 14.1253 5.75684 13.4502 5.75684H11.1445L10.8047 5.75098C10.2158 5.71466 9.65236 5.50645 9.1836 5.1543L8.98926 4.99414C8.91673 4.92948 8.84746 4.85908 8.7461 4.75684L8.55957 4.57422C8.30416 4.34653 7.98784 4.19959 7.65137 4.15039L7.50684 4.13477C7.45779 4.13174 7.4043 4.13184 7.24512 4.13184H6.54981C5.87469 4.13184 5.40624 4.13238 5.04199 4.16211C4.77411 4.184 4.59362 4.21966 4.45703 4.26856L4.33399 4.32129C4.04683 4.4676 3.80618 4.69061 3.63867 4.96387L3.57129 5.08399C3.49494 5.23405 3.44124 5.43543 3.41211 5.79199C3.38238 6.15624 3.38184 6.62469 3.38184 7.29981V8.06836Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (props.name === "compose" || props.name === "edit") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 20 20">
        <path
          d="M2.6687 11.333V8.66699C2.6687 7.74455 2.66841 7.01205 2.71655 6.42285C2.76533 5.82612 2.86699 5.31731 3.10425 4.85156L3.25854 4.57617C3.64272 3.94975 4.19392 3.43995 4.85229 3.10449L5.02905 3.02149C5.44666 2.84233 5.90133 2.75849 6.42358 2.71582C7.01272 2.66769 7.74445 2.66797 8.66675 2.66797H9.16675C9.53393 2.66797 9.83165 2.96586 9.83179 3.33301C9.83179 3.70028 9.53402 3.99805 9.16675 3.99805H8.66675C7.7226 3.99805 7.05438 3.99834 6.53198 4.04102C6.14611 4.07254 5.87277 4.12568 5.65601 4.20313L5.45581 4.28906C5.01645 4.51293 4.64872 4.85345 4.39233 5.27149L4.28979 5.45508C4.16388 5.7022 4.08381 6.01663 4.04175 6.53125C3.99906 7.05373 3.99878 7.7226 3.99878 8.66699V11.333C3.99878 12.2774 3.99906 12.9463 4.04175 13.4688C4.08381 13.9833 4.16389 14.2978 4.28979 14.5449L4.39233 14.7285C4.64871 15.1465 5.01648 15.4871 5.45581 15.7109L5.65601 15.7969C5.87276 15.8743 6.14614 15.9265 6.53198 15.958C7.05439 16.0007 7.72256 16.002 8.66675 16.002H11.3337C12.2779 16.002 12.9461 16.0007 13.4685 15.958C13.9829 15.916 14.2976 15.8367 14.5447 15.7109L14.7292 15.6074C15.147 15.3511 15.4879 14.9841 15.7117 14.5449L15.7976 14.3447C15.8751 14.128 15.9272 13.8546 15.9587 13.4688C16.0014 12.9463 16.0017 12.2774 16.0017 11.333V10.833C16.0018 10.466 16.2997 10.1681 16.6667 10.168C17.0339 10.168 17.3316 10.4659 17.3318 10.833V11.333C17.3318 12.2555 17.3331 12.9879 17.2849 13.5771C17.2422 14.0993 17.1584 14.5541 16.9792 14.9717L16.8962 15.1484C16.5609 15.8066 16.0507 16.3571 15.4246 16.7412L15.1492 16.8955C14.6833 17.1329 14.1739 17.2354 13.5769 17.2842C12.9878 17.3323 12.256 17.332 11.3337 17.332H8.66675C7.74446 17.332 7.01271 17.3323 6.42358 17.2842C5.90135 17.2415 5.44665 17.1577 5.02905 16.9785L4.85229 16.8955C4.19396 16.5601 3.64271 16.0502 3.25854 15.4238L3.10425 15.1484C2.86697 14.6827 2.76534 14.1739 2.71655 13.5771C2.66841 12.9879 2.6687 12.2555 2.6687 11.333ZM13.4646 3.11328C14.4201 2.334 15.8288 2.38969 16.7195 3.28027L16.8865 3.46485C17.6141 4.35685 17.6143 5.64423 16.8865 6.53613L16.7195 6.7207L11.6726 11.7686C11.1373 12.3039 10.4624 12.6746 9.72827 12.8408L9.41089 12.8994L7.59351 13.1582C7.38637 13.1877 7.17701 13.1187 7.02905 12.9707C6.88112 12.8227 6.81199 12.6134 6.84155 12.4063L7.10132 10.5898L7.15991 10.2715C7.3262 9.53749 7.69692 8.86241 8.23218 8.32715L13.2791 3.28027L13.4646 3.11328ZM15.7791 4.2207C15.3753 3.81702 14.7366 3.79124 14.3035 4.14453L14.2195 4.2207L9.17261 9.26856C8.81541 9.62578 8.56774 10.0756 8.45679 10.5654L8.41772 10.7773L8.28296 11.7158L9.22241 11.582L9.43433 11.543C9.92426 11.432 10.3749 11.1844 10.7322 10.8271L15.7791 5.78027L15.8552 5.69629C16.185 5.29194 16.1852 4.708 15.8552 4.30371L15.7791 4.2207Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (props.name === "search") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 21 21">
        <path
          d="M14.6856 9.29553C14.6856 6.34909 12.2971 3.96057 9.35065 3.96057C6.40421 3.96057 4.01569 6.34909 4.01569 9.29553C4.01569 12.242 6.40421 14.6305 9.35065 14.6305C12.2971 14.6305 14.6856 12.242 14.6856 9.29553ZM16.0157 9.29553C16.0157 10.8995 15.4479 12.3701 14.504 13.5201L14.5704 13.5758L17.5704 16.5758L17.6563 16.6793C17.8268 16.9375 17.7976 17.289 17.5704 17.5162C17.3431 17.7431 16.9924 17.7716 16.7344 17.6012L16.6299 17.5162L13.6299 14.5162L13.5753 14.4489C12.4252 15.3928 10.9546 15.9606 9.35065 15.9606C5.66967 15.9606 2.68561 12.9765 2.68561 9.29553C2.68561 5.61455 5.66967 2.63049 9.35065 2.63049C13.0316 2.63049 16.0157 5.61455 16.0157 9.29553Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (props.name === "arrowUp") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 20 20">
        <path
          d="M9.33467 16.6663V4.93978L4.6374 9.63704L4.1667 9.16634L3.69599 8.69661L9.52998 2.86263L9.63447 2.77767C9.8925 2.60753 10.2433 2.63564 10.4704 2.86263L16.3034 8.69661L16.3884 8.80111C16.5588 9.05922 16.5306 9.40982 16.3034 9.63704C16.0762 9.86414 15.7255 9.89242 15.4675 9.722L15.363 9.63704L10.6647 4.9388V16.6663C10.6647 17.0336 10.367 17.3314 9.99971 17.3314C9.63259 17.3312 9.33467 17.0335 9.33467 16.6663ZM4.6374 9.63704C4.3777 9.89674 3.95569 9.89674 3.69599 9.63704C3.43657 9.37744 3.43668 8.95628 3.69599 8.69661L4.6374 9.63704Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (props.name === "settings") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 20 20">
        <path
          d="M9.99944 7.24939C11.5169 7.2495 12.7473 8.47995 12.7475 9.99744C12.7475 11.5151 11.517 12.7454 9.99944 12.7455C8.48176 12.7455 7.2514 11.5151 7.2514 9.99744C7.25155 8.47988 8.48186 7.24939 9.99944 7.24939ZM9.99944 8.57947C9.2164 8.57947 8.58163 9.21442 8.58148 9.99744C8.58148 10.7806 9.2163 11.4154 9.99944 11.4154C10.7825 11.4153 11.4174 10.7805 11.4174 9.99744C11.4173 9.21449 10.7824 8.57958 9.99944 8.57947Z"
          fill="currentColor"
        />
        <path
          d="M10.6391 1.67517C11.2939 1.67532 11.8991 2.02577 12.226 2.59314L13.2485 4.36755H15.2963C15.9505 4.36758 16.555 4.71709 16.8823 5.28357L17.5219 6.39001C17.8489 6.95668 17.8481 7.65542 17.5209 8.22205L16.4975 9.99451L17.5239 11.7689C17.8519 12.3357 17.8521 13.0347 17.5248 13.6019L16.8862 14.7084C16.559 15.2747 15.9543 15.6243 15.3002 15.6244H13.2514L12.2299 17.3988C11.9029 17.9663 11.297 18.3168 10.642 18.3168L9.3637 18.3158C8.71064 18.3155 8.10718 17.9678 7.77972 17.4027L6.74847 15.6234L4.69964 15.6244C4.04558 15.6242 3.44087 15.2747 3.1137 14.7084L2.47503 13.6019C2.14791 13.0349 2.14836 12.3366 2.47601 11.7699L3.50237 9.99548L2.47894 8.22205C2.15175 7.65533 2.15174 6.95673 2.47894 6.39001L3.11761 5.28259C3.44458 4.71663 4.04894 4.36813 4.70257 4.36755L6.75042 4.36658L7.77581 2.59119C8.10301 2.02476 8.7076 1.67527 9.36175 1.67517H10.6391ZM9.36273 3.00623C9.1835 3.00623 9.01679 3.10199 8.92718 3.2572L7.82659 5.16345C7.63652 5.49253 7.28473 5.69529 6.90472 5.69568L4.70355 5.69763C4.52451 5.69782 4.3585 5.79355 4.26898 5.94861L3.6303 7.05505C3.54091 7.2102 3.54077 7.40192 3.6303 7.55701L4.73089 9.46326C4.92108 9.7929 4.92135 10.1992 4.73089 10.5287L3.62737 12.4359C3.5378 12.591 3.53792 12.7817 3.62737 12.9369L4.26605 14.0433C4.35567 14.1982 4.52067 14.2932 4.69964 14.2933L6.90276 14.2943C7.28242 14.2946 7.63335 14.497 7.82366 14.8256L8.93011 16.7357C9.01984 16.8905 9.18578 16.9857 9.36468 16.9857H10.642C10.8213 16.9857 10.987 16.89 11.0766 16.7347L12.1752 14.8275C12.3653 14.4975 12.7182 14.2943 13.0991 14.2943H15.3002C15.4794 14.2942 15.6452 14.1985 15.7348 14.0433L16.3725 12.9379C16.4621 12.7826 16.4621 12.5911 16.3725 12.4359L15.27 10.5287C15.1032 10.2404 15.0808 9.89331 15.2055 9.59021L15.269 9.46326L16.3696 7.55701C16.4591 7.40189 16.459 7.21022 16.3696 7.05505L15.7309 5.94861C15.6412 5.79363 15.4754 5.69863 15.2963 5.69861L13.0951 5.69763L12.9535 5.68884C12.6751 5.65158 12.4217 5.50519 12.2504 5.28259L12.1723 5.16443L11.0737 3.2572C10.9841 3.10175 10.8175 3.00525 10.6381 3.00525L9.36273 3.00623Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (props.name === "shield" || props.name === "shieldAlert") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 20 20">
        <path
          d="M9.06543 1.95123C9.66107 1.69076 10.3389 1.69071 10.9346 1.95123L15.9346 4.13873C16.7832 4.51008 17.3311 5.34917 17.3311 6.27545V10.5528C17.3309 14.6017 14.0489 17.8847 10 17.8848C5.95108 17.8846 2.66813 14.6017 2.66797 10.5528V6.27545C2.66797 5.34924 3.21695 4.51012 4.06543 4.13873L9.06543 1.95123ZM10.4014 3.16998C10.1456 3.05814 9.85444 3.05819 9.59863 3.16998L4.59863 5.35748C4.23427 5.51708 3.99805 5.87764 3.99805 6.27545V10.5528C3.99821 13.8671 6.68563 16.5546 10 16.5547C13.3144 16.5546 16.0008 13.8671 16.001 10.5528V6.27545C16.001 5.87756 15.7658 5.51703 15.4014 5.35748L10.4014 3.16998Z"
          fill="currentColor"
        />
        {props.name === "shieldAlert" ? (
          <path
            d="M9.333 6.667h1.334v4.166H9.333V6.667Zm0 5.834h1.334v1.333H9.333v-1.333Z"
            fill="currentColor"
          />
        ) : (
          <path
            d="M13.4678 11.4318L13.333 11.4182H10.833C10.466 11.4183 10.1682 11.7162 10.168 12.0832C10.168 12.4504 10.4659 12.7481 10.833 12.7482H13.333L13.4678 12.7346C13.7706 12.6724 13.9981 12.4044 13.9981 12.0832C13.9979 11.7621 13.7706 11.494 13.4678 11.4318ZM7.65336 12.426C7.46431 12.7406 7.05607 12.8424 6.74125 12.6535C6.42646 12.4646 6.32395 12.0563 6.51274 11.7414L7.55668 10.0002L6.51274 8.25899C6.32395 7.94412 6.42646 7.53583 6.74125 7.34688C7.05607 7.15799 7.46431 7.25975 7.65336 7.57442L8.90336 9.6584C9.0296 9.86893 9.0296 10.1315 8.90336 10.342L7.65336 12.426Z"
            fill="currentColor"
          />
        )}
      </svg>
    );
  }

  if (props.name === "terminal") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 20 20">
        <path
          d="M6.19629 7.86231C6.42357 7.63534 6.7752 7.60692 7.0332 7.77734L7.1377 7.86231L8.80371 9.5293C9.06329 9.78889 9.06307 10.21 8.80371 10.4697L7.1377 12.1367C6.878 12.3964 6.45599 12.3964 6.19629 12.1367C5.93686 11.8771 5.93697 11.456 6.19629 11.1963L7.39258 9.99902L6.19629 8.80371L6.11133 8.69922C5.94087 8.4411 5.96904 8.08955 6.19629 7.86231Z"
          fill="currentColor"
        />
        <path
          d="M13.4668 11.0156C13.7699 11.0776 13.998 11.3456 13.998 11.667C13.9979 11.9883 13.7698 12.2564 13.4668 12.3184L13.333 12.332H10.833C10.466 12.3319 10.1682 12.034 10.168 11.667C10.168 11.2998 10.4659 11.0021 10.833 11.002H13.333L13.4668 11.0156Z"
          fill="currentColor"
        />
        <path
          d="M12.6602 2.66504C13.3492 2.66504 13.9062 2.66439 14.3564 2.70117C14.8142 2.73859 15.2201 2.81796 15.5967 3.00977C16.1922 3.31321 16.677 3.79805 16.9805 4.39356C17.1722 4.77014 17.2517 5.17604 17.2891 5.63379C17.3258 6.08402 17.3252 6.64102 17.3252 7.33008V12.6602C17.3252 13.3492 17.3258 13.9062 17.2891 14.3564C17.2516 14.8142 17.1723 15.2201 16.9805 15.5967C16.677 16.1922 16.1922 16.677 15.5967 16.9805C15.2201 17.1723 14.8142 17.2516 14.3564 17.2891C13.9062 17.3258 13.3492 17.3252 12.6602 17.3252H7.33008C6.64102 17.3252 6.08402 17.3258 5.63379 17.2891C5.17604 17.2517 4.77014 17.1722 4.39356 16.9805C3.79805 16.677 3.31321 16.1922 3.00977 15.5967C2.81796 15.2201 2.73859 14.8142 2.70117 14.3564C2.66439 13.9062 2.66504 13.3492 2.66504 12.6602V7.33008C2.66504 6.64101 2.66439 6.08402 2.70117 5.63379C2.73858 5.17601 2.81797 4.77016 3.00977 4.39356C3.31321 3.79802 3.79802 3.31321 4.39356 3.00977C4.77016 2.81797 5.17601 2.73858 5.63379 2.70117C6.08402 2.66439 6.64101 2.66504 7.33008 2.66504H12.6602ZM7.33008 3.99512C6.61907 3.99512 6.1257 3.99601 5.74219 4.02734C5.3665 4.05804 5.15508 4.11481 4.99707 4.19531C4.65183 4.37124 4.37124 4.65183 4.19531 4.99707C4.11481 5.15508 4.05805 5.3665 4.02734 5.74219C3.99601 6.1257 3.99512 6.61908 3.99512 7.33008V12.6602C3.99512 13.3711 3.99601 13.8646 4.02734 14.248C4.05805 14.6237 4.11481 14.8352 4.19531 14.9932C4.37124 15.3384 4.65186 15.619 4.99707 15.7949C5.15507 15.8754 5.36654 15.9322 5.74219 15.9629C6.1257 15.9942 6.61908 15.9951 7.33008 15.9951H12.6602C13.3711 15.9951 13.8646 15.9942 14.248 15.9629C14.6237 15.9322 14.8352 15.8754 14.9932 15.7949C15.3384 15.619 15.619 15.3384 15.7949 14.9932C15.8754 14.8352 15.9322 14.6237 15.9629 14.248C15.9942 13.8646 15.9951 13.3711 15.9951 12.6602V7.33008C15.9951 6.61908 15.9942 6.1257 15.9629 5.74219C15.9322 5.36654 15.8754 5.15507 15.7949 4.99707C15.619 4.65186 15.3384 4.37124 14.9932 4.19531C14.8352 4.11481 14.6237 4.05805 14.248 4.02734C13.8646 3.99601 13.3711 3.99512 12.6602 3.99512H7.33008Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  const strokeProps = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.7
  };

  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 20 20">
      {props.name === "plus" ? <path d="M10 4.3v11.4M4.3 10h11.4" {...strokeProps} /> : null}
      {props.name === "more" ? (
        <path d="M5 10h.01M10 10h.01M15 10h.01" {...strokeProps} />
      ) : null}
      {props.name === "collapse" ? (
        <>
          <rect height="14" rx="2.6" width="14" x="3" y="3" {...strokeProps} />
          <path d="M8 3v14" {...strokeProps} />
        </>
      ) : null}
      {props.name === "back" ? <path d="M12.8 4.2 7 10l5.8 5.8M7.7 10h8" {...strokeProps} /> : null}
      {props.name === "forward" ? <path d="m7.2 4.2 5.8 5.8-5.8 5.8M4.3 10h8" {...strokeProps} /> : null}
      {props.name === "plug" ? (
        <>
          <circle cx="6.4" cy="6.4" r="2.1" {...strokeProps} />
          <circle cx="13.6" cy="6.4" r="2.1" {...strokeProps} />
          <circle cx="6.4" cy="13.6" r="2.1" {...strokeProps} />
          <circle cx="13.6" cy="13.6" r="2.1" {...strokeProps} />
        </>
      ) : null}
      {props.name === "clock" ? (
        <>
          <circle cx="10" cy="10" r="7" {...strokeProps} />
          <path d="M10 5.8V10l2.8 2.1" {...strokeProps} />
        </>
      ) : null}
      {props.name === "hand" ? (
        <path
          d="M7.2 9.7V5.6a1.1 1.1 0 0 1 2.2 0v3.2M9.4 8.7V4.8a1.1 1.1 0 0 1 2.2 0v4M11.6 9V6a1.1 1.1 0 0 1 2.2 0v5.2c0 3.1-1.7 5.2-4.7 5.2H8c-1.4 0-2.4-.5-3.2-1.5L2.9 12a1.1 1.1 0 0 1 1.8-1.3l1.1 1.4V8.4a1.1 1.1 0 0 1 2.2 0v1.3"
          {...strokeProps}
        />
      ) : null}
      {props.name === "check" ? <path d="m4.2 10.5 3.4 3.4 8.2-8.3" {...strokeProps} /> : null}
      {props.name === "chevronLeft" ? <path d="m12 5-5 5 5 5" {...strokeProps} /> : null}
      {props.name === "chevronRight" ? <path d="m8 5 5 5-5 5" {...strokeProps} /> : null}
      {props.name === "chevronDown" ? <path d="m5 8 5 5 5-5" {...strokeProps} /> : null}
      {props.name === "phone" ? (
        <>
          <rect height="15" rx="2.2" width="8.4" x="5.8" y="2.5" {...strokeProps} />
          <path d="M8.7 14.7h2.6" {...strokeProps} />
        </>
      ) : null}
      {props.name === "x" ? <path d="m5.2 5.2 9.6 9.6M14.8 5.2l-9.6 9.6" {...strokeProps} /> : null}
    </svg>
  );
}

export function DesignLab(props: { flow?: DesignFlow; initialState?: DesignState }) {
  const initialFlow = props.flow ?? "current";
  const initialFlowConfig = getDesignFlow(initialFlow);
  const [activeFlow, setActiveFlow] = useState<DesignFlow>(initialFlow);
  const [activeState, setActiveState] = useState<DesignState>(
    props.initialState ?? initialFlowConfig.defaultState
  );
  const [projectName, setProjectName] = useState("CodexNext");
  const [permission, setPermission] = useState("请求批准");
  const [model, setModel] = useState("5.5 超高");
  const [draft, setDraft] = useState("");

  const selectedFlow = getDesignFlow(activeFlow);
  const selectedState = designStates.find((state) => state.id === activeState);
  const visibleStates = selectedFlow.states
    .map((state) => designStateById.get(state))
    .filter((state): state is (typeof designStates)[number] => Boolean(state));

  function openState(state: DesignState) {
    setActiveState(state);
  }

  function openFlow(flow: DesignFlow) {
    const nextFlow = getDesignFlow(flow);
    setActiveFlow(nextFlow.id);
    setActiveState(nextFlow.defaultState);
  }

  function sendDraft() {
    if (activeState === "running") {
      return;
    }
    setDraft("");
    setActiveState("chat");
  }

  return (
    <main className="cn-design-lab">
      <aside className="cn-design-control">
        <div className="cn-design-control-heading">
          <span>CodexNext</span>
          <strong>设计工作台</strong>
          <p>长期运行的 React/CSS 设计系统。只做 UI 和交互，不连 agent。</p>
        </div>

        <div className="cn-design-flow-list" aria-label="设计流">
          {designFlows.map((flow) => (
            <a
              key={flow.id}
              className={
                activeFlow === flow.id
                  ? "cn-design-flow-button active"
                  : "cn-design-flow-button"
              }
              href={flow.href}
              onClick={(event) => {
                event.preventDefault();
                openFlow(flow.id);
              }}
            >
              <strong>{flow.label}</strong>
              <span>{flow.description}</span>
            </a>
          ))}
        </div>

        <div className="cn-design-state-section">
          <span className="cn-design-section-label">当前 flow 状态</span>
          <div className="cn-design-state-list">
            {visibleStates.map((state) => (
              <button
                key={state.id}
                className={
                  activeState === state.id
                    ? "cn-design-state-button active"
                    : "cn-design-state-button"
                }
                type="button"
                onClick={() => openState(state.id)}
              >
                <strong>{state.label}</strong>
                <span>{state.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="cn-design-notes">
          <strong>设计约定</strong>
          <p>新阶段先进入对应 flow，用假数据调 UI；确认后再对接真实 agent。</p>
          <p>普通新会话不出现 Goal，也不出现 Token Budget。</p>
        </div>
      </aside>

      <section className="cn-design-preview-area">
        <header className="cn-design-preview-header">
          <div>
            <span>{selectedFlow.label}</span>
            <strong>{selectedState?.label}</strong>
          </div>
          <a href="/" aria-label="Open live console">
            真实控制台
          </a>
        </header>

        {activeFlow === "components" ? (
          <DesignComponentGallery
            model={model}
            permission={permission}
            onOpenModel={() => openState("model")}
            onOpenPermission={() => openState("permission")}
          />
        ) : activeFlow === "archive" ? (
          <DesignArchivePanel />
        ) : (
          <CodexDesktopMock
            activeState={activeState}
            draft={draft}
            model={model}
            permission={permission}
            projectName={projectName}
            onDraftChange={setDraft}
            onOpenDevice={() => openState("device")}
            onOpenProject={() => openState("project")}
            onOpenPermission={() => openState("permission")}
            onOpenModel={() => openState("model")}
            onSend={sendDraft}
            onSelectProject={(value) => {
              setProjectName(value);
              setActiveState("typing");
            }}
            onSelectPermission={(value) => {
              setPermission(value);
              setActiveState("typing");
            }}
            onSelectModel={(value) => {
              setModel(value);
              setActiveState("typing");
            }}
            onCloseOverlay={() => setActiveState("empty")}
            onNewChat={() => {
              setDraft("");
              setActiveState("project");
            }}
            onInterrupt={() => setActiveState("chat")}
            onOpenApproval={() => setActiveState("approval")}
            onStartRunning={() => setActiveState("running")}
          />
        )}
      </section>
    </main>
  );
}

function DesignComponentGallery(props: {
  model: string;
  permission: string;
  onOpenModel: () => void;
  onOpenPermission: () => void;
}) {
  const iconNames: CodexIconName[] = [
    "compose",
    "search",
    "folder",
    "terminal",
    "settings",
    "collapse",
    "back",
    "forward",
    "plus",
    "more",
    "arrowUp",
    "shield",
    "shieldAlert",
    "hand",
    "check",
    "phone"
  ];

  return (
    <section className="cn-design-component-gallery">
      <div className="cn-component-hero">
        <span>Codex-style registry</span>
        <h2>组件和图标先在这里统一，再进入真实页面。</h2>
        <p>
          这里是持续维护的组件样板间：以后新增 Goal、diff、events、设备管理，
          都先补到这个 flow，确认后再接真实数据。
        </p>
      </div>

      <div className="cn-component-grid">
        <article className="cn-component-card wide">
          <span className="cn-component-label">Composer</span>
          <DesktopComposer
            activeState="typing"
            draft=""
            model={props.model}
            permission={props.permission}
            projectName="CodexNext"
            running={false}
            onDraftChange={() => undefined}
            onOpenModel={props.onOpenModel}
            onOpenPermission={props.onOpenPermission}
            onSend={() => undefined}
            onStartRunning={() => undefined}
          />
        </article>

        <article className="cn-component-card">
          <span className="cn-component-label">Device card</span>
          <button className="cn-device-summary sample" type="button">
            <CodexIcon name="terminal" className="cn-device-icon" />
            <span className="cn-live-dot" />
            <span className="cn-device-copy">
              <strong>MacBookAir</strong>
              <small>在线 · codex-cli 0.137</small>
            </span>
          </button>
        </article>

        <article className="cn-component-card">
          <span className="cn-component-label">Menu rows</span>
          <button className="cn-menu-row with-icon selected" type="button">
            <CodexIcon name="shieldAlert" />
            <span>
              <strong>完全访问权限</strong>
              <small>不受限制地访问互联网和本机文件</small>
            </span>
            <em>
              <CodexIcon name="check" />
            </em>
          </button>
          <button className="cn-menu-row compact selected" type="button">
            <strong>超高</strong>
            <em>
              <CodexIcon name="check" />
            </em>
          </button>
        </article>

        <article className="cn-component-card wide">
          <span className="cn-component-label">Icon registry</span>
          <div className="cn-icon-grid">
            {iconNames.map((icon) => (
              <div key={icon} className="cn-icon-swatch" title={icon}>
                <CodexIcon name={icon} />
                <span>{icon}</span>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function DesignArchivePanel() {
  return (
    <section className="cn-design-archive">
      <div>
        <span>Archive</span>
        <h2>旧版本留在归档里，新版本只维护当前 flow。</h2>
        <p>
          以后不会继续用 10-19、20-29 这种编号堆图。每个阶段只新增稳定 flow，
          旧截图、Figma 输出和被替换的方案放进归档，方便回看但不干扰当前实现。
        </p>
      </div>
      <div className="cn-archive-list">
        <article>
          <strong>Phase 2A nine-grid</strong>
          <span>最早的九宫格新会话设计草图，已被当前 flow 结构替代。</span>
          <code>docs/design/phase2-new-chat-ui-9grid.svg</code>
        </article>
        <article>
          <strong>Figma desktop exploration</strong>
          <span>桌面 Web 设计探索稿，作为视觉参考，不直接作为实现源。</span>
          <code>docs/design/figma-phase2-new-chat-ui.png</code>
        </article>
        <article>
          <strong>Codex icon registry</strong>
          <span>Codex 风图标系统说明，后续所有 UI 图标从这里扩展。</span>
          <code>docs/design/CODEX_ICON_SYSTEM.md</code>
        </article>
      </div>
    </section>
  );
}

function CodexDesktopMock(props: {
  activeState: DesignState;
  draft: string;
  model: string;
  permission: string;
  projectName: string;
  onDraftChange: (value: string) => void;
  onOpenDevice: () => void;
  onOpenProject: () => void;
  onOpenPermission: () => void;
  onOpenModel: () => void;
  onSend: () => void;
  onSelectProject: (value: string) => void;
  onSelectPermission: (value: string) => void;
  onSelectModel: (value: string) => void;
  onCloseOverlay: () => void;
  onNewChat: () => void;
  onInterrupt: () => void;
  onOpenApproval: () => void;
  onStartRunning: () => void;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const inThread =
    props.activeState === "chat" ||
    props.activeState === "running" ||
    props.activeState === "approval";
  const running = props.activeState === "running";
  const revealMainOnMobile = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches) {
      setSidebarCollapsed(true);
    }
  };
  const openDevice = () => {
    revealMainOnMobile();
    props.onOpenDevice();
  };
  const openNewChat = () => {
    revealMainOnMobile();
    props.onNewChat();
  };
  const selectThread = () => {
    revealMainOnMobile();
    props.onSend();
  };

  return (
    <div
      className={
        sidebarCollapsed
          ? "cn-desktop-frame sidebar-collapsed"
          : "cn-desktop-frame"
      }
    >
      <NavigationRail
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
        onOpenDevice={openDevice}
        onNewChat={openNewChat}
      />
      <SessionSidebar
        activeProject={props.projectName}
        onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
        onNewChat={openNewChat}
        onOpenDevice={openDevice}
        onSelectThread={selectThread}
      />

      <section className={inThread ? "cn-main thread" : "cn-main"}>
        <DesktopHeader
          activeState={props.activeState}
          model={props.model}
          onOpenApproval={props.onOpenApproval}
          onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
          projectName={props.projectName}
          sidebarCollapsed={sidebarCollapsed}
        />

        {inThread ? (
          <ThreadCanvas
            running={running}
            onInterrupt={props.onInterrupt}
            onOpenApproval={props.onOpenApproval}
            onStartRunning={props.onStartRunning}
          />
        ) : (
          <NewChatCanvas activeState={props.activeState} />
        )}

        <DesktopComposer
          draft={props.draft}
          model={props.model}
          permission={props.permission}
          projectName={props.projectName}
          running={running}
          activeState={props.activeState}
          onDraftChange={props.onDraftChange}
          onOpenModel={props.onOpenModel}
          onOpenPermission={props.onOpenPermission}
          onSend={props.onSend}
          onStartRunning={props.onStartRunning}
        />

        {props.activeState === "device" ? (
          <DeviceSheet onClose={props.onCloseOverlay} />
        ) : null}
        {props.activeState === "project" ? (
          <ProjectSheet
            selectedProject={props.projectName}
            onSelect={props.onSelectProject}
          />
        ) : null}
        {props.activeState === "permission" ? (
          <PermissionMenu
            selected={props.permission}
            onSelect={props.onSelectPermission}
          />
        ) : null}
        {props.activeState === "model" ? (
          <ModelMenu selected={props.model} onSelect={props.onSelectModel} />
        ) : null}
        {props.activeState === "approval" ? <ApprovalModal /> : null}
      </section>
    </div>
  );
}

function NavigationRail(props: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenDevice: () => void;
  onNewChat: () => void;
}) {
  return (
    <nav className="cn-nav-rail" aria-label="Design lab navigation">
      <div className="cn-mark">CN</div>
      {props.sidebarCollapsed ? (
        <button
          className="cn-rail-button"
          type="button"
          onClick={props.onToggleSidebar}
          aria-label="展开会话栏"
        >
          <CodexIcon name="collapse" />
        </button>
      ) : null}
      <button
        className="cn-rail-button active"
        type="button"
        onClick={props.onOpenDevice}
        aria-label="选择设备"
      >
        <CodexIcon name="terminal" />
        <span className="cn-rail-dot" />
      </button>
      <button
        className="cn-rail-button"
        type="button"
        onClick={props.onNewChat}
        aria-label="新建对话"
      >
        <CodexIcon name="compose" />
      </button>
      <button className="cn-rail-button muted" type="button" aria-label="更多">
        <CodexIcon name="more" />
      </button>
    </nav>
  );
}

function SessionSidebar(props: {
  activeProject: string;
  onToggleSidebar: () => void;
  onNewChat: () => void;
  onOpenDevice: () => void;
  onSelectThread: () => void;
}) {
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => new Set(["账单签收件_12个PDF_2026-06"])
  );

  function toggleProject(projectName: string) {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectName)) {
        next.delete(projectName);
      } else {
        next.add(projectName);
      }
      return next;
    });
  }

  return (
    <aside className="cn-session-sidebar">
      <div className="cn-sidebar-fixed">
        <div className="cn-sidebar-windowbar" aria-label="窗口导航">
          <span className="cn-window-dot red" />
          <span className="cn-window-dot yellow" />
          <span className="cn-window-dot green" />
          <button type="button" aria-label="折叠会话栏" onClick={props.onToggleSidebar}>
            <CodexIcon name="collapse" />
          </button>
          <button type="button" aria-label="后退" onClick={props.onNewChat}>
            <CodexIcon name="back" />
          </button>
          <button type="button" aria-label="前进" onClick={props.onSelectThread}>
            <CodexIcon name="forward" />
          </button>
        </div>

        <div className="cn-sidebar-brand">
          <strong>CodexNext</strong>
          <span>Your personal Codex control plane</span>
        </div>

        <button className="cn-device-summary" type="button" onClick={props.onOpenDevice}>
          <CodexIcon name="terminal" className="cn-device-icon" />
          <span className="cn-live-dot" />
          <span className="cn-device-copy">
            <strong>MacBookAir</strong>
            <small>在线 · codex-cli 0.137</small>
          </span>
        </button>

        <button className="cn-new-chat-button" type="button" onClick={props.onNewChat}>
          <CodexIcon name="compose" />
          新建对话
        </button>
      </div>

      <div className="cn-project-tree">
        <span className="cn-project-tree-title">项目</span>
        <div className="cn-project-scroll">
          {projectTree.map((project) => (
            <div key={project.name} className="cn-project-group">
              <button
                className="cn-project-name"
                title={project.name}
                type="button"
                onClick={() => toggleProject(project.name)}
              >
                <span className="cn-project-heading-copy">
                  <CodexIcon name="folder" className="cn-project-icon" />
                  <strong>{project.name}</strong>
                </span>
                <CodexIcon
                  name={collapsedProjects.has(project.name) ? "chevronRight" : "chevronDown"}
                  className="cn-project-collapse-icon"
                />
              </button>
              {collapsedProjects.has(project.name) ? null : (
                <div className="cn-thread-list">
                  {project.sessions.map((session) => (
                    <button
                      key={`${project.name}-${session}`}
                      className={
                        props.activeProject === session
                          ? "cn-thread-row selected"
                          : "cn-thread-row"
                      }
                      title={session}
                      type="button"
                      onClick={props.onSelectThread}
                    >
                      <span>{session}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="cn-sidebar-footer">
        <button className="cn-settings-button" type="button" aria-label="设置">
          <span>
            <CodexIcon name="settings" />
            设置
          </span>
          <CodexIcon name="phone" />
        </button>
      </div>
    </aside>
  );
}

function DesktopHeader(props: {
  activeState: DesignState;
  model: string;
  onOpenApproval: () => void;
  onToggleSidebar: () => void;
  projectName: string;
  sidebarCollapsed: boolean;
}) {
  const inThread =
    props.activeState === "chat" ||
    props.activeState === "running" ||
    props.activeState === "approval";
  const title =
    inThread ? props.projectName : "新会话";
  const status =
    props.activeState === "running"
      ? "正在处理 · 可以继续追加指令"
      : "MacBookAir · 在线";

  return (
    <header className="cn-main-header">
      <button
        className="cn-mobile-menu-button"
        type="button"
        onClick={props.onToggleSidebar}
        aria-label={props.sidebarCollapsed ? "展开目录" : "收起目录"}
      >
        <CodexIcon name={props.sidebarCollapsed ? "collapse" : "chevronLeft"} />
      </button>
      <div>
        <h1>{title}</h1>
        <p>{status}</p>
      </div>
      <div className="cn-live-header-actions">
        {inThread ? (
          <button className="cn-soft-button" type="button">
            Goal
          </button>
        ) : null}
        <button className="cn-soft-button" type="button" onClick={props.onOpenApproval}>
          Events #128
        </button>
        {props.activeState === "running" ? (
          <button className="cn-soft-button danger" type="button">
            Interrupt
          </button>
        ) : null}
      </div>
    </header>
  );
}

function NewChatCanvas(_props: { activeState: DesignState }) {
  return (
    <section className="cn-empty-canvas cn-live-empty">
      <div className="cn-empty-copy">
        <h2>要在 CodexNext 中构建什么？</h2>
        <p>
          像 Codex 一样从底部输入开始。新会话设置只在弹窗里完成：
          选择设备、项目文件夹、权限、模型和推理深度。
        </p>
      </div>
    </section>
  );
}

function ThreadCanvas(props: {
  running: boolean;
  onInterrupt: () => void;
  onOpenApproval: () => void;
  onStartRunning: () => void;
}) {
  return (
    <section className="cn-thread-canvas">
      <article className="cn-message user">
        检查这个项目，先告诉我有哪些明显问题
      </article>
      <article className="cn-message assistant">
        {props.running ? (
          <>
            <span className="cn-running-note">Codex 正在处理 · 已用时 46s</span>
            <p>计划已更新，准备执行命令。</p>
            <p>我会先检查 package、agent 和 web 的边界。</p>
          </>
        ) : (
          <>
            <p>我会先检查 workspace、agent 和 web 的边界。</p>
            <p>然后给你可验证的问题列表。</p>
          </>
        )}
      </article>
      <article className="cn-message command">
        <span>$ rg --files apps packages</span>
      </article>
      {props.running ? (
        <button className="cn-inline-stop" type="button" onClick={props.onInterrupt}>
          停止当前 turn
        </button>
      ) : (
        <button className="cn-inline-approval-trigger" type="button" onClick={props.onOpenApproval}>
          预览审批请求
        </button>
      )}
    </section>
  );
}

function DesktopComposer(props: {
  draft: string;
  model: string;
  permission: string;
  projectName: string;
  running: boolean;
  activeState: DesignState;
  onDraftChange: (value: string) => void;
  onOpenModel: () => void;
  onOpenPermission: () => void;
  onSend: () => void;
  onStartRunning: () => void;
}) {
  const inputValue =
    props.activeState === "typing" && !props.draft
      ? "检查这个项目，先告诉我\n有哪些明显问题"
      : props.running
        ? "先不要改代码，只输出问题列表"
        : props.draft;

  return (
    <footer className={props.running ? "cn-desktop-composer steer" : "cn-desktop-composer"}>
      <textarea
        aria-label="设计输入框"
        placeholder={props.running ? "追加指令或调整方向..." : "要在 CodexNext 中构建什么？"}
        value={inputValue}
        onChange={(event) => props.onDraftChange(event.target.value)}
      />
      <div className="cn-composer-toolbar">
        <button className="cn-icon-button" type="button" title="上传文件">
          <CodexIcon name="plus" />
        </button>
        <button className="cn-composer-pill" type="button" onClick={props.onOpenModel}>
          {props.model}
          <CodexIcon name="chevronDown" />
        </button>
        <button className="cn-composer-pill" type="button" onClick={props.onOpenPermission}>
          {props.permission}
          <CodexIcon name="chevronDown" />
        </button>
        <button
          className="cn-send-button"
          type="button"
          disabled={!inputValue.trim()}
          onClick={props.running ? props.onStartRunning : props.onSend}
        >
          <CodexIcon name="arrowUp" />
        </button>
      </div>
    </footer>
  );
}

function DeviceSheet(props: { onClose: () => void }) {
  return (
    <div className="cn-overlay-panel device">
      <div className="cn-sheet-card cn-live-sheet">
        <button className="cn-close-button" type="button" onClick={props.onClose}>
          <CodexIcon name="x" />
        </button>
        <h2>连接设备</h2>
        <p>设备名代表你要控制的 Codex Agent，可以是这台 Mac，也可以是远程服务器。</p>

        <div className="cn-real-device-row online">
          <CodexIcon name="terminal" />
          <span className="cn-live-dot" />
          <div>
            <strong>MacBookAir</strong>
            <small>connected · codex-cli 0.137</small>
          </div>
        </div>

        <label>
          设备名称
          <input value="MacBookAir" readOnly />
        </label>
        <label>
          Agent URL
          <input value="http://127.0.0.1:17361" readOnly />
        </label>
        <label>
          Access Token
          <input value="cn-demo-token" readOnly />
        </label>

        <div className="cn-sheet-actions">
          <button className="cn-soft-button" type="button" onClick={props.onClose}>
            取消
          </button>
          <button className="cn-primary-button" type="button">
            重新连接
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectSheet(props: {
  selectedProject: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="cn-overlay-panel project">
      <div className="cn-project-card cn-live-session-sheet">
        <button className="cn-close-button cn-sticky-close" type="button">
          <CodexIcon name="x" />
        </button>
        <h2>新会话设置</h2>

        <button className="cn-settings-row" type="button">
          <span>设备</span>
          <strong>MacBookAir</strong>
          <small>connected</small>
        </button>

        <div className="cn-project-search">
          <CodexIcon name="search" />
          /Users/ganxing/Dev/CodexNext
        </div>

        <div className="cn-folder-picker-actions">
          <button className="cn-soft-button" type="button">
            Home
          </button>
          <button className="cn-soft-button" type="button">
            上级
          </button>
          <button className="cn-soft-button" type="button">
            浏览
          </button>
        </div>

        <div className="cn-path-label">/Users/ganxing/Dev</div>
        <div className="cn-folder-list cn-real-folder-list">
          {["CodexNext", "dailywork", "CLIProxyAPI", "agent-social-publisher", "local-tools"].map((folder) => (
            <button
              key={folder}
              className={
                props.selectedProject === folder || folder === "CodexNext"
                  ? "cn-folder-row selected"
                  : "cn-folder-row"
              }
              type="button"
              onClick={() => props.onSelect(folder)}
            >
              <CodexIcon name="folder" />
              <span>{folder}</span>
            </button>
          ))}
        </div>

        <button
          className="cn-primary-button cn-use-folder-button"
          type="button"
          onClick={() => props.onSelect("CodexNext")}
        >
          使用此文件夹
        </button>

        <div className="cn-session-settings-grid">
          <label>
            模型
            <select value="gpt-5.5" onChange={() => undefined}>
              <option>GPT-5.5</option>
            </select>
          </label>
          <label>
            推理
            <select value="xhigh" onChange={() => undefined}>
              <option value="xhigh">超高</option>
            </select>
          </label>
        </div>

        <div className="cn-permission-list-real">
          <p>权限模式：请求批准</p>
          {[
            ["hand", "请求批准", "编辑外部文件和使用互联网时始终询问"],
            ["shield", "替我审批", "仅对检测到的风险操作请求批准"],
            ["shieldAlert", "完全访问权限", "可不受限制地访问互联网和电脑上的任何文件"],
            ["settings", "自定义 config.toml", "使用 config.toml 中定义的权限"]
          ].map(([icon, label, description]) => (
            <button
              key={label}
              className={label === "请求批准" ? "cn-menu-row with-icon selected" : "cn-menu-row with-icon"}
              type="button"
            >
              <CodexIcon name={icon as CodexIconName} />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              {label === "请求批准" ? (
                <em>
                  <CodexIcon name="check" />
                </em>
              ) : null}
            </button>
          ))}
        </div>

        <details className="cn-goal-advanced">
          <summary>Goal（可选，高级）</summary>
          <label>
            Objective
            <textarea
              readOnly
              placeholder="如果这次新会话需要 Goal，再在这里设置。普通聊天不用填。"
            />
          </label>
          <label>
            Token Budget
            <input inputMode="numeric" placeholder="optional" readOnly />
          </label>
        </details>
      </div>
    </div>
  );
}

function PermissionMenu(props: {
  selected: string;
  onSelect: (value: string) => void;
}) {
  const permissions: Array<{
    description: string;
    icon: CodexIconName;
    label: string;
  }> = [
    {
      description: "编辑外部文件和使用互联网时始终询问",
      icon: "hand",
      label: "请求批准"
    },
    {
      description: "仅对检测到的风险操作请求批准",
      icon: "shield",
      label: "替我审批"
    },
    {
      description: "可不受限制地访问互联网和电脑上的任何文件",
      icon: "shieldAlert",
      label: "完全访问权限"
    },
    {
      description: "使用 config.toml 中定义的权限",
      icon: "settings",
      label: "自定义 config.toml"
    }
  ];

  return (
    <div className="cn-popover permission">
      <p>应如何批准 Codex 操作？</p>
      {permissions.map((permission) => (
        <button
          key={permission.label}
          className={
            props.selected === permission.label
              ? "cn-menu-row with-icon selected"
              : "cn-menu-row with-icon"
          }
          type="button"
          onClick={() => props.onSelect(permission.label)}
        >
          <CodexIcon name={permission.icon} />
          <span>
            <strong>{permission.label}</strong>
            <small>{permission.description}</small>
          </span>
          {props.selected === permission.label ? (
            <em>
              <CodexIcon name="check" />
            </em>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function ModelMenu(props: {
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="cn-popover model">
      <p>推理</p>
      {["低", "中", "高", "超高"].map((effort) => (
        <button
          key={effort}
          className={props.selected.includes(effort) ? "cn-menu-row selected compact" : "cn-menu-row compact"}
          type="button"
          onClick={() => props.onSelect(`5.5 ${effort}`)}
        >
          <strong>{effort}</strong>
          {props.selected.includes(effort) ? (
            <em>
              <CodexIcon name="check" />
            </em>
          ) : null}
        </button>
      ))}
      <div className="cn-menu-divider" />
      {["GPT-5.5", "GPT-5.4", "GPT-5.4 Mini", "GPT-5.3 Codex Spark"].map((modelName) => (
        <button
          key={modelName}
          className={props.selected.includes(modelName.replace("GPT-", "")) ? "cn-menu-row selected compact" : "cn-menu-row compact"}
          type="button"
          onClick={() => props.onSelect(`${modelName.replace("GPT-", "")} 超高`)}
        >
          <strong>{modelName}</strong>
          {modelName === "GPT-5.5" ? (
            <em>
              <CodexIcon name="check" />
            </em>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function ApprovalModal() {
  return (
    <div className="cn-approval-backdrop">
      <div className="cn-inline-approval">
        <strong>Codex 请求批准</strong>
        <span>pnpm test</span>
      </div>
      <section className="cn-approval-modal">
        <h2>Codex 请求批准</h2>
        <p>命令将读取并运行本地项目测试。</p>
        <pre>{`cwd: /Users/ganxing/Dev/CodexNext\n$ pnpm test`}</pre>
        <div className="cn-approval-actions">
          <button className="cn-primary-button" type="button">
            接受
          </button>
          <button className="cn-soft-button" type="button">
            本次会话
          </button>
          <button className="cn-soft-button" type="button">
            拒绝
          </button>
          <button className="cn-soft-button wide" type="button">
            取消
          </button>
        </div>
      </section>
    </div>
  );
}
