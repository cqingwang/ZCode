import { useWorkspaceSidebarMobileViewport } from "./useWorkspaceSidebarMobileViewport.js";
import {
  resolveWorkspaceSidebarCollapsedWidthPx,
  resolveWorkspaceSidebarOverlayMode,
} from "./workspaceSidebarLayout.js";

/**
 * 左侧任务栏覆盖层形态与收起占位宽度。
 *
 * Why：视口断点只在这里订阅一次，Shell 只消费派生值；
 * 覆盖层判定与宽度规则下沉到纯函数，避免布局组件继续堆积条件分支。
 */
export function useWorkspaceSidebarOverlay({
  isWebRemoteControlShell,
  hasDesktopPanelInset,
  isWindowsDesktop,
}: {
  isWebRemoteControlShell: boolean;
  hasDesktopPanelInset: boolean;
  isWindowsDesktop?: boolean;
}) {
  const isSidebarMobileViewport = useWorkspaceSidebarMobileViewport();
  const isSidebarOverlayMode = resolveWorkspaceSidebarOverlayMode({
    isWebRemoteControlShell,
    isSidebarMobileViewport,
  });

  return {
    isSidebarMobileViewport,
    isSidebarOverlayMode,
    collapsedSidebarWidthPx: resolveWorkspaceSidebarCollapsedWidthPx({
      isOverlayMode: isSidebarOverlayMode,
      hasDesktopPanelInset,
      isWindowsDesktop,
    }),
  };
}
