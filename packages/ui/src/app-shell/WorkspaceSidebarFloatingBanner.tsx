import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { PanelLeftOpen } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";
import {
  clampWorkspaceSidebarBannerOffset,
  isWorkspaceSidebarBannerClick,
  persistWorkspaceSidebarBannerOffset,
  readWorkspaceSidebarBannerOffset,
  WORKSPACE_SIDEBAR_BANNER_FALLBACK_SIZE_PX,
  type WorkspaceSidebarViewportOffset,
} from "@/lib/workspaceSidebarCollapse.js";

interface DragSession {
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: WorkspaceSidebarViewportOffset;
  movedDistancePx: number;
}

/**
 * 移动端屏幕收起侧栏后的悬浮操作按钮。
 *
 * 交互契约：只在侧栏收起时出现（展开即隐藏，避免遮挡会话区）；单图标，可拖动改位置并持久化，
 * 落位钳制在视口内；点击展开侧栏。
 * 位置是纯 UI 局部状态，不进入 store——它既不是服务端事实，也不需要跨进程同步。
 */
export function WorkspaceSidebarFloatingBanner({
  className,
  onExpandSidebar,
}: {
  className?: string;
  onExpandSidebar: () => void;
}) {
  const { intl } = useZCodeIntl();
  const expandTitle = intl.formatMessage({ id: "workspaceSidebar.showSidebar" });
  const elementRef = useRef<HTMLButtonElement | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  // 拖动结束时浏览器仍会派发 click；这里记录“本次要吞掉的 click”，避免拖完误触发展开。
  const suppressNextClickRef = useRef(false);
  const [offset, setOffset] = useState<WorkspaceSidebarViewportOffset>(() =>
    readWorkspaceSidebarBannerOffset(),
  );

  const clampToViewport = useCallback((next: WorkspaceSidebarViewportOffset) => {
    const element = elementRef.current;
    return clampWorkspaceSidebarBannerOffset({
      offset: next,
      viewportWidthPx: typeof window === "undefined" ? 0 : window.innerWidth,
      viewportHeightPx: typeof window === "undefined" ? 0 : window.innerHeight,
      bannerWidthPx: element?.offsetWidth ?? WORKSPACE_SIDEBAR_BANNER_FALLBACK_SIZE_PX.width,
      bannerHeightPx: element?.offsetHeight ?? WORKSPACE_SIDEBAR_BANNER_FALLBACK_SIZE_PX.height,
    });
  }, []);

  useEffect(() => {
    // 视口变化（旋转屏幕/分屏）后原位置可能落到屏幕外，按新视口重新钳制。
    const handleResize = () => {
      setOffset((current) => clampToViewport(current));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampToViewport]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 && event.pointerType === "mouse") {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      dragSessionRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startOffset: offset,
        movedDistancePx: 0,
      };
    },
    [offset],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) {
        return;
      }
      const deltaX = event.clientX - session.startX;
      const deltaY = event.clientY - session.startY;
      session.movedDistancePx = Math.max(session.movedDistancePx, Math.hypot(deltaX, deltaY));
      // 拖动中直接钳制，按钮不会被拖出屏幕外丢失。
      setOffset(
        clampToViewport({
          left: session.startOffset.left + deltaX,
          top: session.startOffset.top + deltaY,
        }),
      );
    },
    [clampToViewport],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== event.pointerId) {
        return;
      }
      dragSessionRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      const isDrag = !isWorkspaceSidebarBannerClick({ movedDistancePx: session.movedDistancePx });
      // 展开只在 click 里做：触摸输入下 pointerup 之后浏览器还会按坐标重新命中派发 click，
      // 若在这里就展开，遮罩已先挂载，那个 click 会落到遮罩上把侧栏又收起，
      // 表现为“点悬浮按钮侧栏无任何反应”。
      suppressNextClickRef.current = isDrag;
      if (isDrag) {
        persistWorkspaceSidebarBannerOffset(offset);
      }
    },
    [offset],
  );

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    dragSessionRef.current = null;
    suppressNextClickRef.current = true;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  // 展开的唯一入口：键盘 Enter/Space 只派发 click（detail=0），鼠标/触摸在 pointer 序列后派发 click。
  const handleClick = useCallback(() => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    onExpandSidebar();
  }, [onExpandSidebar]);

  return (
    <button
      ref={elementRef}
      type="button"
      data-testid="workspace-sidebar-floating-banner"
      aria-label={expandTitle}
      title={expandTitle}
      style={{ left: offset.left, top: offset.top }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
      // touch-none：移动端浏览器会把触摸拖动识别为页面滚动，禁掉原生手势才能拖动按钮。
      className={cn(
        "absolute z-50 flex size-11 touch-none items-center justify-center rounded-full border border-border bg-surface/95 text-foreground shadow-md backdrop-blur-sm select-none [app-region:no-drag]",
        className,
      )}
    >
      <PanelLeftOpen className="size-4" aria-hidden="true" />
    </button>
  );
}
