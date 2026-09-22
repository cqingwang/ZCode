/**
 * 左侧任务栏抽拉面板的收起/展开领域规则。
 *
 * Why：侧栏显隐的唯一真实状态由 `useAppPanels` 持有，这里只收敛“初始态、切换态、
 * 悬浮 banner 可见性与位置”这类可判定规则，保持纯函数（无 IO、storage 注入），
 * 让 Web/移动端窗口尺寸相关的交互约束能被单元测试直接覆盖。
 */
import type { BrowserStorageLike } from "@/lib/browserEnvironment.js";
import { getSafeLocalStorage } from "@/lib/browserEnvironment.js";

/** 与样式里 `max-md` 断点保持一致：小于该宽度视为移动端屏幕。 */
const WORKSPACE_SIDEBAR_MOBILE_VIEWPORT_MAX_WIDTH_PX = 767;
const WORKSPACE_SIDEBAR_MOBILE_VIEWPORT_MEDIA_QUERY = `(max-width: ${WORKSPACE_SIDEBAR_MOBILE_VIEWPORT_MAX_WIDTH_PX}px)`;

const WORKSPACE_SIDEBAR_COLLAPSED_STORAGE_KEY = "zcode:workspace-shell:sidebar-collapsed";
const WORKSPACE_SIDEBAR_BANNER_OFFSET_STORAGE_KEY = "zcode:workspace-shell:sidebar-banner-offset";

/**
 * 悬浮 banner 的默认位置（左上角悬浮）。
 * 顶部浮层（新建任务/更新按钮）占 56px 高，默认 top 落在其下方，避免两个入口互相遮挡。
 */
const WORKSPACE_SIDEBAR_BANNER_TOP_OVERLAY_INSET_PX = 68;
export const WORKSPACE_SIDEBAR_BANNER_DEFAULT_OFFSET_PX = {
  left: 12,
  top: WORKSPACE_SIDEBAR_BANNER_TOP_OVERLAY_INSET_PX,
};
/** 拖动后落位的最小边距，避免 banner 被拖出可视区。 */
export const WORKSPACE_SIDEBAR_BANNER_VIEWPORT_INSET_PX = 8;
/** 位移超过该阈值视为拖动而非点击，避免拖动结束误触发展开。 */
const WORKSPACE_SIDEBAR_BANNER_CLICK_MOVE_THRESHOLD_PX = 6;
/** 首次测量前用于钳制的兜底尺寸，避免 banner 落在视口外。 */
export const WORKSPACE_SIDEBAR_BANNER_FALLBACK_SIZE_PX = { width: 44, height: 44 };

export interface WorkspaceSidebarViewportOffset {
  left: number;
  top: number;
}

interface ReadOffsetOptions {
  offset: Partial<WorkspaceSidebarViewportOffset> | null | undefined;
  viewportWidthPx: number;
  viewportHeightPx: number;
  bannerWidthPx: number;
  bannerHeightPx: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isViewportOffset(value: unknown): value is WorkspaceSidebarViewportOffset {
  return (
    typeof value === "object" &&
    value !== null &&
    isFiniteNumber((value as WorkspaceSidebarViewportOffset).left) &&
    isFiniteNumber((value as WorkspaceSidebarViewportOffset).top)
  );
}

/**
 * 把 banner 偏移钳制到视口内。
 *
 * 视口比 banner 还窄时收敛到左边距，保证控件至少可见可点。
 */
export function clampWorkspaceSidebarBannerOffset({
  offset,
  viewportWidthPx,
  viewportHeightPx,
  bannerWidthPx,
  bannerHeightPx,
}: ReadOffsetOptions): WorkspaceSidebarViewportOffset {
  const fallback = WORKSPACE_SIDEBAR_BANNER_DEFAULT_OFFSET_PX;
  const requestedLeft = isFiniteNumber(offset?.left) ? (offset.left as number) : fallback.left;
  const requestedTop = isFiniteNumber(offset?.top) ? (offset.top as number) : fallback.top;
  const maxLeft = Math.max(
    WORKSPACE_SIDEBAR_BANNER_VIEWPORT_INSET_PX,
    viewportWidthPx - bannerWidthPx - WORKSPACE_SIDEBAR_BANNER_VIEWPORT_INSET_PX,
  );
  const maxTop = Math.max(
    WORKSPACE_SIDEBAR_BANNER_VIEWPORT_INSET_PX,
    viewportHeightPx - bannerHeightPx - WORKSPACE_SIDEBAR_BANNER_VIEWPORT_INSET_PX,
  );

  return {
    left: Math.round(
      Math.min(
        Math.max(WORKSPACE_SIDEBAR_BANNER_VIEWPORT_INSET_PX, requestedLeft),
        Math.min(maxLeft, viewportWidthPx - WORKSPACE_SIDEBAR_BANNER_VIEWPORT_INSET_PX),
      ),
    ),
    top: Math.round(
      Math.min(
        Math.max(WORKSPACE_SIDEBAR_BANNER_VIEWPORT_INSET_PX, requestedTop),
        Math.min(maxTop, viewportHeightPx - WORKSPACE_SIDEBAR_BANNER_VIEWPORT_INSET_PX),
      ),
    ),
  };
}

export function readWorkspaceSidebarCollapsedPreference(
  storage: BrowserStorageLike | null = getSafeLocalStorage(),
): boolean | null {
  try {
    const rawValue = storage?.getItem(WORKSPACE_SIDEBAR_COLLAPSED_STORAGE_KEY) ?? null;
    if (rawValue !== "true" && rawValue !== "false") {
      return null;
    }
    return rawValue === "true";
  } catch {
    return null;
  }
}

export function persistWorkspaceSidebarCollapsedPreference(
  collapsed: boolean,
  storage: BrowserStorageLike | null = getSafeLocalStorage(),
): void {
  try {
    storage?.setItem(WORKSPACE_SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
  } catch {
    // 受限浏览器或 SSR 场景写入失败不能阻断侧栏交互。
  }
}

/**
 * 首帧侧栏收起态：用户显式选择优先，其次移动端屏幕默认收起，其余保持展开。
 *
 * Why：移动端窗口宽度有限，默认展开会把会话区挤到不可用；一旦用户手动展开就不再被默认值覆盖。
 */
export function resolveWorkspaceSidebarInitialCollapsed({
  mobileViewportMatch,
  storedPreference,
}: {
  mobileViewportMatch: boolean;
  storedPreference: boolean | null;
}): boolean {
  if (storedPreference !== null) {
    return storedPreference;
  }
  return mobileViewportMatch;
}

/**
 * 切换后的收起态：入参是切换后的可见态，取反即收起态。
 *
 * Why：写入点必须与 React 状态更新用的是同一个 next 值。之前把「当前可见态」当入参，
 * 语义取反导致持久化结果与实际操作相反——收起后刷新又被展开。
 */
export function resolveWorkspaceSidebarCollapsedAfterToggle(
  nextIsSidebarVisible: boolean,
): boolean {
  return !nextIsSidebarVisible;
}

/** 悬浮 banner 只在移动端屏幕且侧栏收起时出现：展开后遮挡会话区，没有意义。 */
export function shouldShowWorkspaceSidebarFloatingBanner({
  mobileViewportMatch,
  isSidebarCollapsed,
}: {
  mobileViewportMatch: boolean;
  isSidebarCollapsed: boolean;
}): boolean {
  return mobileViewportMatch && isSidebarCollapsed;
}

/**
 * 移动端屏幕下侧栏改为覆盖层（overlay），收起/展开都脱离流式布局。
 *
 * Why：移动端屏幕宽度有限，收起后若继续占用流式布局，展开时会把会话区挤到不可读；
 * 覆盖层复用外层已有的 width 过渡即可得到抽拉动画，无需再引入抽屉状态机。
 * 桌面端保持流式布局，收起时仍按 collapsedSidebarWidthPx 收边。
 */
export function shouldRenderWorkspaceSidebarAsOverlay({
  mobileViewportMatch,
}: {
  mobileViewportMatch: boolean;
}): boolean {
  return mobileViewportMatch;
}

/** 覆盖层模式下收起宽度恒为 0：桌面 4px 外沿留白只为贴边面板服务，抽屉不需要。 */
export const WORKSPACE_SIDEBAR_OVERLAY_COLLAPSED_WIDTH_PX = 0;

/**
 * 延边三角形角标的可见性。
 *
 * 展开态挂在侧栏右延边（收起入口）；收起态挂在窗口左边缘（展开入口），
 * 移动端收起态交给悬浮 banner，避免同一屏出现两个同义入口。
 */
export function shouldShowWorkspaceSidebarCollapseTab({
  mobileViewportMatch,
  isSidebarCollapsed,
}: {
  mobileViewportMatch: boolean;
  isSidebarCollapsed: boolean;
}): boolean {
  return !isSidebarCollapsed || !mobileViewportMatch;
}

export function readWorkspaceSidebarBannerOffset(
  storage: BrowserStorageLike | null = getSafeLocalStorage(),
): WorkspaceSidebarViewportOffset {
  try {
    const rawValue = storage?.getItem(WORKSPACE_SIDEBAR_BANNER_OFFSET_STORAGE_KEY) ?? null;
    if (!rawValue) {
      return WORKSPACE_SIDEBAR_BANNER_DEFAULT_OFFSET_PX;
    }
    const parsed = JSON.parse(rawValue) as unknown;
    return isViewportOffset(parsed)
      ? { left: parsed.left, top: parsed.top }
      : WORKSPACE_SIDEBAR_BANNER_DEFAULT_OFFSET_PX;
  } catch {
    return WORKSPACE_SIDEBAR_BANNER_DEFAULT_OFFSET_PX;
  }
}

export function persistWorkspaceSidebarBannerOffset(
  offset: WorkspaceSidebarViewportOffset,
  storage: BrowserStorageLike | null = getSafeLocalStorage(),
): void {
  try {
    storage?.setItem(
      WORKSPACE_SIDEBAR_BANNER_OFFSET_STORAGE_KEY,
      JSON.stringify({ left: offset.left, top: offset.top }),
    );
  } catch {
    // 同上：偏好写入失败只影响下次首帧位置。
  }
}

/** 拖动结束位移小于阈值按点击处理，点击用于展开侧栏。 */
export function isWorkspaceSidebarBannerClick({
  movedDistancePx,
}: {
  movedDistancePx: number;
}): boolean {
  return movedDistancePx < WORKSPACE_SIDEBAR_BANNER_CLICK_MOVE_THRESHOLD_PX;
}

interface MediaQueryLike {
  matches: boolean;
  addEventListener?: (type: "change", listener: (event: { matches: boolean }) => void) => void;
  removeEventListener?: (type: "change", listener: (event: { matches: boolean }) => void) => void;
}

type MatchMediaLike = (query: string) => MediaQueryLike;

function resolveDefaultMatchMedia(): MatchMediaLike | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return undefined;
  }
  return (query: string) => window.matchMedia(query);
}

/** 一次性读取移动端视口匹配；SSR 或无 matchMedia 环境按非移动端处理。 */
export function readWorkspaceSidebarMobileViewportMatch(
  matchMedia: MatchMediaLike | undefined = resolveDefaultMatchMedia(),
): boolean {
  if (!matchMedia) {
    return false;
  }
  try {
    return matchMedia(WORKSPACE_SIDEBAR_MOBILE_VIEWPORT_MEDIA_QUERY).matches === true;
  } catch {
    return false;
  }
}

/**
 * 订阅移动端视口匹配变化（旋转屏幕 / 拖窗口跨过断点）。
 *
 * 返回取消订阅函数；环境不支持 matchMedia 时返回空订阅，调用方无需分支。
 */
export function subscribeWorkspaceSidebarMobileViewportMatch(
  onMatchChange: (matches: boolean) => void,
  matchMedia: MatchMediaLike | undefined = resolveDefaultMatchMedia(),
): () => void {
  if (!matchMedia) {
    return () => {};
  }
  let queryResult: MediaQueryLike;
  try {
    queryResult = matchMedia(WORKSPACE_SIDEBAR_MOBILE_VIEWPORT_MEDIA_QUERY);
  } catch {
    return () => {};
  }
  const listener = (event: { matches: boolean }) => onMatchChange(event.matches === true);
  queryResult.addEventListener?.("change", listener);
  return () => {
    queryResult.removeEventListener?.("change", listener);
  };
}
