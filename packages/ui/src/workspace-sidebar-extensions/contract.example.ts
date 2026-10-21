/**
 * 左侧任务栏增强的标准接入方式：状态由 hook 提供，渲染层只挂载交互层。
 */
import type { WorkspaceSidebarVisibility } from "./contract.js";

export function exampleWorkspaceSidebarVisibility(
  visibility: WorkspaceSidebarVisibility,
  toggle: () => void,
): void {
  if (!visibility.isSidebarVisible) {
    toggle();
  }
}
