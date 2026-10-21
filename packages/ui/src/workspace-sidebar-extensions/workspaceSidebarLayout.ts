import { cn } from "@/components/lib/utils.js";
import {
  shouldRenderWorkspaceSidebarAsOverlay,
  WORKSPACE_SIDEBAR_OVERLAY_COLLAPSED_WIDTH_PX,
} from "./workspaceSidebarCollapse.js";

/**
 * 左侧任务栏收起后的占位宽度。
 *
 * Why：覆盖层模式必须收为 0，否则抽屉关闭时仍会留下桌面贴边留白；
 * 桌面端保留原有的 4/6px 视觉外沿。
 */
export function resolveWorkspaceSidebarCollapsedWidthPx({
  isOverlayMode,
  hasDesktopPanelInset,
  isWindowsDesktop,
}: {
  isOverlayMode: boolean;
  hasDesktopPanelInset: boolean;
  isWindowsDesktop?: boolean;
}): number {
  if (isOverlayMode) {
    return WORKSPACE_SIDEBAR_OVERLAY_COLLAPSED_WIDTH_PX;
  }
  if (!hasDesktopPanelInset) {
    return 0;
  }
  return isWindowsDesktop ? 6 : 4;
}

/** 是否把左侧任务栏渲染为移动端抽屉覆盖层；远控壳使用顶部导航，不能复用该形态。 */
export function resolveWorkspaceSidebarOverlayMode({
  isWebRemoteControlShell,
  isSidebarMobileViewport,
}: {
  isWebRemoteControlShell: boolean;
  isSidebarMobileViewport: boolean;
}): boolean {
  return (
    !isWebRemoteControlShell &&
    shouldRenderWorkspaceSidebarAsOverlay({ mobileViewportMatch: isSidebarMobileViewport })
  );
}

/**
 * 覆盖层模式下追加到侧栏面板的类名；非覆盖层返回 undefined。
 *
 * Why：上游的面板基础类名继续留在 Shell 里，这里只追加覆盖层语义。
 * 这样官方调整基础布局时能直接合并，不会因为本地复制了一份类名而静默漂移。
 */
export function resolveWorkspaceSidebarPanelOverlayClassName({
  isOverlayMode,
  isSidebarPanelVisible,
}: {
  isOverlayMode: boolean;
  isSidebarPanelVisible: boolean;
}): string | undefined {
  if (!isOverlayMode) {
    return undefined;
  }
  return cn(
    // 脱离流式布局盖在会话区上，展开不挤压内容；收起宽度恒为 0，同一个 width 过渡即得到抽拉动画。
    // 上游基础类含 max-w-[50%]，这里用 important 覆盖，避免 Tailwind 输出顺序决定胜负。
    "absolute inset-y-0 left-0 z-40 !max-w-[min(20rem,86%)] bg-background shadow-xl",
    // 分隔线只在展开态加：box-sizing 下 border 会让收起宽度多出 1px，抽屉会露边。
    isSidebarPanelVisible && "border-r border-border",
  );
}
