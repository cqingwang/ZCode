import { WorkspaceSidebarCollapseTab } from "./WorkspaceSidebarCollapseTab.js";
import { WorkspaceSidebarFloatingBanner } from "./WorkspaceSidebarFloatingBanner.js";
import {
  shouldShowWorkspaceSidebarCollapseTab,
  shouldShowWorkspaceSidebarFloatingBanner,
} from "./workspaceSidebarCollapse.js";

/**
 * 左侧任务栏收起/展开的交互层：抽屉遮罩、延边角标与移动端悬浮按钮。
 *
 * Why：这些入口只依赖显隐状态与视口断点，抽成独立组件后
 * WorkspaceShellLayout 只保留一处挂载，降低与上游布局改动的耦合。
 */
export function WorkspaceSidebarCollapseLayer({
  isOverlayMode,
  isSidebarMobileViewport,
  isSidebarVisible,
  isWebRemoteControlShell,
  onToggleSidebar,
  toggleSidebarShortcutLabel,
}: {
  isOverlayMode: boolean;
  isSidebarMobileViewport: boolean;
  isSidebarVisible: boolean;
  isWebRemoteControlShell: boolean;
  onToggleSidebar: () => void;
  toggleSidebarShortcutLabel?: string;
}) {
  return (
    <>
      {isOverlayMode && isSidebarVisible ? (
        // 覆盖层模式下补一层遮罩：点空白处即收起，与抽屉的通用交互一致。
        // 复用同一个 toggle 入口，不引入第二份收起状态。
        <div
          data-testid="workspace-sidebar-overlay-scrim"
          aria-hidden="true"
          className="absolute inset-0 z-30 bg-black/40 supports-backdrop-filter:backdrop-blur-xs"
          onClick={onToggleSidebar}
        />
      ) : null}
      {!isWebRemoteControlShell ? (
        <>
          <WorkspaceSidebarCollapseTab
            isSidebarCollapsed={!isSidebarVisible}
            hidden={
              !shouldShowWorkspaceSidebarCollapseTab({
                mobileViewportMatch: isSidebarMobileViewport,
                isSidebarCollapsed: !isSidebarVisible,
              })
            }
            onToggleSidebar={onToggleSidebar}
            toggleSidebarShortcutLabel={toggleSidebarShortcutLabel}
          />
          {shouldShowWorkspaceSidebarFloatingBanner({
            mobileViewportMatch: isSidebarMobileViewport,
            isSidebarCollapsed: !isSidebarVisible,
          }) ? (
            <WorkspaceSidebarFloatingBanner onExpandSidebar={onToggleSidebar} />
          ) : null}
        </>
      ) : null}
    </>
  );
}
