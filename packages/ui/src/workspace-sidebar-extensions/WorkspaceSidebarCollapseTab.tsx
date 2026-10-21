import { TriangleRightIcon } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { cn } from "@/components/lib/utils.js";

interface WorkspaceSidebarCollapseTabProps {
  /** 侧栏是否处于收起态：决定三角指向与点击语义。 */
  isSidebarCollapsed: boolean;
  /** 移动端收起态交给悬浮 banner，避免同屏出现两个同义展开入口。 */
  hidden: boolean;
  onToggleSidebar: () => void;
  toggleSidebarShortcutLabel?: string;
}

/**
 * 左侧任务栏延边的三角形角标。
 *
 * Why（实现方式）：侧栏宽度在外层 shell 上是 CSS 变量驱动的
 * （`--workspace-sidebar-panel-width`，拖拽宽度时只写 DOM 样式不 setState），
 * 所以角标必须用 `translate-x-[var(--workspace-sidebar-panel-width)]` 跟随面板右延边，
 * 才能既贴住抽拉边缘，又不需要在拖拽/收起动画期间触发 React 重渲染。
 */
export function WorkspaceSidebarCollapseTab({
  isSidebarCollapsed,
  hidden,
  onToggleSidebar,
  toggleSidebarShortcutLabel,
}: WorkspaceSidebarCollapseTabProps) {
  const { intl } = useZCodeIntl();
  const toggleTitle = intl.formatMessage({ id: "workspaceSidebar.toggleSidebar" });
  // lucide 只提供了朝右的实心三角；展开态指向左（收起方向）用 180° 旋转复用同一图标。
  const triangleClassName = cn("size-3", isSidebarCollapsed ? "rotate-0" : "rotate-180");

  return (
    <div
      data-testid="workspace-sidebar-collapse-tab"
      aria-hidden={hidden}
      className={cn(
        "absolute top-1/2 left-0 z-50 transition-[translate,opacity] duration-200 ease-out",
        // 该变量在 WorkspaceShellLayout 的 shell 根节点上声明，Tailwind 直接写死类名即可。
        "translate-y-[-50%] translate-x-[var(--workspace-sidebar-panel-width)]",
        hidden && "pointer-events-none opacity-0",
      )}
    >
      <ControlHintTooltip
        title={toggleTitle}
        shortcut={toggleSidebarShortcutLabel}
        side="right"
        sideOffset={8}
      >
        <button
          type="button"
          // 隐藏态保留 DOM 以复用过渡动画，但要退出 Tab 焦点链，避免键盘用户聚焦到不可见入口。
          tabIndex={hidden ? -1 : 0}
          aria-label={toggleTitle}
          // Electron 窗口拖拽区优先级高于子元素点击，浮在标题栏上方的入口必须显式 no-drag。
          className="flex h-10 w-4 items-center justify-center rounded-r-md border border-l-0 border-border bg-surface text-foreground-subtle shadow-sm transition-colors [app-region:no-drag] hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => onToggleSidebar()}
        >
          <TriangleRightIcon className={triangleClassName} aria-hidden="true" />
        </button>
      </ControlHintTooltip>
    </div>
  );
}
