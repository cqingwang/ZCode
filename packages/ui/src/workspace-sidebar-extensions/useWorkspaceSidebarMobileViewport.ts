import { useEffect, useState } from "react";
import {
  readWorkspaceSidebarMobileViewportMatch,
  subscribeWorkspaceSidebarMobileViewportMatch,
} from "./workspaceSidebarCollapse.js";

/** 订阅移动端屏幕断点；旋转屏幕或拖窗口跨过断点时驱动侧栏覆盖层与入口切换。 */
export function useWorkspaceSidebarMobileViewport(): boolean {
  const [isMobileViewport, setIsMobileViewport] = useState(readWorkspaceSidebarMobileViewportMatch);

  useEffect(() => subscribeWorkspaceSidebarMobileViewportMatch(setIsMobileViewport), []);

  return isMobileViewport;
}
