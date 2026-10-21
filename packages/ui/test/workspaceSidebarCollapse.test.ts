// Web 抽拉侧栏收起/展开交互的领域规则回归测试。
// 覆盖：移动端默认收起、用户显式偏好优先、偏好持久化回环、
// 悬浮 banner 仅“移动端 + 收起态”可见、banner 位置钳制与点击/拖动区分。
import { describe, expect, it } from "vitest";
import {
  WORKSPACE_SIDEBAR_BANNER_DEFAULT_OFFSET_PX,
  WORKSPACE_SIDEBAR_BANNER_VIEWPORT_INSET_PX,
  clampWorkspaceSidebarBannerOffset,
  isWorkspaceSidebarBannerClick,
  persistWorkspaceSidebarBannerOffset,
  persistWorkspaceSidebarCollapsedPreference,
  readWorkspaceSidebarBannerOffset,
  readWorkspaceSidebarCollapsedPreference,
  readWorkspaceSidebarMobileViewportMatch,
  resolveWorkspaceSidebarCollapsedAfterToggle,
  resolveWorkspaceSidebarInitialCollapsed,
  shouldShowWorkspaceSidebarFloatingBanner,
} from "../src/workspace-sidebar-extensions/workspaceSidebarCollapse.ts";

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("workspaceSidebarCollapse", () => {
  it("移动端屏幕首帧默认收起侧栏，桌面屏幕默认展开", () => {
    expect(
      resolveWorkspaceSidebarInitialCollapsed({
        mobileViewportMatch: true,
        storedPreference: null,
      }),
    ).toBe(true);
    expect(
      resolveWorkspaceSidebarInitialCollapsed({
        mobileViewportMatch: false,
        storedPreference: null,
      }),
    ).toBe(false);
  });

  it("用户显式偏好覆盖移动端默认收起", () => {
    expect(
      resolveWorkspaceSidebarInitialCollapsed({
        mobileViewportMatch: true,
        storedPreference: false,
      }),
    ).toBe(false);
    expect(
      resolveWorkspaceSidebarInitialCollapsed({
        mobileViewportMatch: false,
        storedPreference: true,
      }),
    ).toBe(true);
  });

  it("收起偏好写入后可原样读回，脏数据回退为未设置", () => {
    const storage = createMemoryStorage();
    expect(readWorkspaceSidebarCollapsedPreference(storage)).toBeNull();
    persistWorkspaceSidebarCollapsedPreference(true, storage);
    expect(readWorkspaceSidebarCollapsedPreference(storage)).toBe(true);
    persistWorkspaceSidebarCollapsedPreference(false, storage);
    expect(readWorkspaceSidebarCollapsedPreference(storage)).toBe(false);
    expect(
      readWorkspaceSidebarCollapsedPreference(
        createMemoryStorage({ "zcode:workspace-shell:sidebar-collapsed": "yes" }),
      ),
    ).toBeNull();
  });

  it("切换后收起态由切换后的可见态取反（唯一写入路径）", () => {
    // 展开 → 收起：写入 collapsed=true；收起 → 展开：写入 collapsed=false。
    // 这条断言是持久化取反缺陷（收起后刷新又被展开）的回归护栏。
    expect(resolveWorkspaceSidebarCollapsedAfterToggle(false)).toBe(true);
    expect(resolveWorkspaceSidebarCollapsedAfterToggle(true)).toBe(false);
  });

  it("悬浮 banner 只在移动端且侧栏收起时可见", () => {
    expect(
      shouldShowWorkspaceSidebarFloatingBanner({
        mobileViewportMatch: true,
        isSidebarCollapsed: true,
      }),
    ).toBe(true);
    // 展开后 banner 必须隐藏，避免遮挡会话区。
    expect(
      shouldShowWorkspaceSidebarFloatingBanner({
        mobileViewportMatch: true,
        isSidebarCollapsed: false,
      }),
    ).toBe(false);
    // 桌面宽窗口不出现悬浮 banner（角标即入口）。
    expect(
      shouldShowWorkspaceSidebarFloatingBanner({
        mobileViewportMatch: false,
        isSidebarCollapsed: true,
      }),
    ).toBe(false);
  });

  it("banner 偏移默认左上角且被钳制在视口内", () => {
    const storage = createMemoryStorage();
    expect(readWorkspaceSidebarBannerOffset(storage)).toEqual(
      WORKSPACE_SIDEBAR_BANNER_DEFAULT_OFFSET_PX,
    );

    const clamped = clampWorkspaceSidebarBannerOffset({
      offset: { left: 4000, top: -500 },
      viewportWidthPx: 390,
      viewportHeightPx: 844,
      bannerWidthPx: 160,
      bannerHeightPx: 40,
    });
    expect(clamped.left).toBe(390 - 160 - WORKSPACE_SIDEBAR_BANNER_VIEWPORT_INSET_PX);
    expect(clamped.top).toBe(WORKSPACE_SIDEBAR_BANNER_VIEWPORT_INSET_PX);

    persistWorkspaceSidebarBannerOffset({ left: 20, top: 30 }, storage);
    expect(readWorkspaceSidebarBannerOffset(storage)).toEqual({ left: 20, top: 30 });
    // 损坏的持久化位置回退默认值而不是 NaN。
    expect(
      readWorkspaceSidebarBannerOffset(
        createMemoryStorage({ "zcode:workspace-shell:sidebar-banner-offset": "{oops" }),
      ),
    ).toEqual(WORKSPACE_SIDEBAR_BANNER_DEFAULT_OFFSET_PX);
  });

  it("拖动位移未超阈值按点击处理", () => {
    expect(isWorkspaceSidebarBannerClick({ movedDistancePx: 0 })).toBe(true);
    expect(isWorkspaceSidebarBannerClick({ movedDistancePx: 5.9 })).toBe(true);
    expect(isWorkspaceSidebarBannerClick({ movedDistancePx: 6 })).toBe(false);
  });

  it("无 matchMedia 环境按非移动端处理且读取 matchMedia 不抛异常", () => {
    expect(readWorkspaceSidebarMobileViewportMatch(undefined)).toBe(false);
    expect(readWorkspaceSidebarMobileViewportMatch(() => ({ matches: true }))).toBe(true);
    expect(
      readWorkspaceSidebarMobileViewportMatch(() => {
        throw new Error("document is undefined");
      }),
    ).toBe(false);
  });
});
