/**
 * 左侧任务栏本地增强的对外契约。
 *
 * 唯一状态所有者是 `useWorkspaceSidebarVisibility`；渲染层只消费可见性、
 * 视口断点和纯布局派生值，不另存第二份收起状态。
 */
export interface WorkspaceSidebarVisibility {
  /** 侧栏当前是否可见；收起态会持久化到本地偏好。 */
  isSidebarVisible: boolean;
  /** 唯一 toggle 入口，供按钮、角标、悬浮 banner 与快捷键共用。 */
  handleToggleSidebar: () => void;
}

export interface WorkspaceSidebarOverlayState {
  /** 当前视口是否处于移动端屏幕断点（<768px）。 */
  isSidebarMobileViewport: boolean;
  /** 是否把侧栏渲染为覆盖层抽屉；远控壳始终为 false。 */
  isSidebarOverlayMode: boolean;
  /** 收起态占位宽度；覆盖层恒为 0。 */
  collapsedSidebarWidthPx: number;
}
