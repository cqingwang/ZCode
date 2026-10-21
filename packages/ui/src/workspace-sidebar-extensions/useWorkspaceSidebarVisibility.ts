import { useCallback, useEffect, useRef, useState } from "react";
import {
  persistWorkspaceSidebarCollapsedPreference,
  readWorkspaceSidebarCollapsedPreference,
  readWorkspaceSidebarMobileViewportMatch,
  resolveWorkspaceSidebarCollapsedAfterToggle,
  resolveWorkspaceSidebarInitialCollapsed,
} from "./workspaceSidebarCollapse.js";

/**
 * 左侧任务栏显隐的唯一状态所有者。
 *
 * Why：首帧默认值、用户偏好持久化和 toggle 入口必须收敛在一处，避免 App/Shell 各自维护
 * 一份可见性状态。移动端断点只影响首帧默认值和渲染层，不需要作为状态向外透传。
 */
export function useWorkspaceSidebarVisibility() {
  const [isSidebarVisible, setIsSidebarVisible] = useState(() => {
    const mobileViewportMatch = readWorkspaceSidebarMobileViewportMatch();
    const storedPreference = readWorkspaceSidebarCollapsedPreference();
    return !resolveWorkspaceSidebarInitialCollapsed({ mobileViewportMatch, storedPreference });
  });

  // 跳过首次提交，保留「用户从未选择过」的空偏好，让移动端默认收起规则在下次访问继续生效。
  const persistencePrimedRef = useRef(false);
  useEffect(() => {
    if (!persistencePrimedRef.current) {
      persistencePrimedRef.current = true;
      return;
    }
    persistWorkspaceSidebarCollapsedPreference(
      resolveWorkspaceSidebarCollapsedAfterToggle(isSidebarVisible),
    );
  }, [isSidebarVisible]);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarVisible((visible) => !visible);
  }, []);

  return { isSidebarVisible, handleToggleSidebar };
}
