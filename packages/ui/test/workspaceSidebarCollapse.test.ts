// Web 抽拉侧栏收起/展开交互的领域规则回归测试。
// 覆盖：移动端默认收起、用户显式偏好优先、偏好持久化回环、
// 悬浮 banner 仅“移动端 + 收起态”可见、banner 位置钳制与点击/拖动区分。
import assert from "node:assert/strict";
import test from "node:test";
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
} from "../src/lib/workspaceSidebarCollapse.ts";

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test("移动端屏幕首帧默认收起侧栏，桌面屏幕默认展开", () => {
  assert.equal(
    resolveWorkspaceSidebarInitialCollapsed({
      mobileViewportMatch: true,
      storedPreference: null,
    }),
    true,
  );
  assert.equal(
    resolveWorkspaceSidebarInitialCollapsed({
      mobileViewportMatch: false,
      storedPreference: null,
    }),
    false,
  );
});

test("用户显式偏好覆盖移动端默认收起", () => {
  assert.equal(
    resolveWorkspaceSidebarInitialCollapsed({
      mobileViewportMatch: true,
      storedPreference: false,
    }),
    false,
  );
  assert.equal(
    resolveWorkspaceSidebarInitialCollapsed({
      mobileViewportMatch: false,
      storedPreference: true,
    }),
    true,
  );
});

test("收起偏好写入后可原样读回，脏数据回退为未设置", () => {
  const storage = createMemoryStorage();
  assert.equal(readWorkspaceSidebarCollapsedPreference(storage), null);
  persistWorkspaceSidebarCollapsedPreference(true, storage);
  assert.equal(readWorkspaceSidebarCollapsedPreference(storage), true);
  persistWorkspaceSidebarCollapsedPreference(false, storage);
  assert.equal(readWorkspaceSidebarCollapsedPreference(storage), false);
  assert.equal(
    readWorkspaceSidebarCollapsedPreference(
      createMemoryStorage({ "zcode:workspace-shell:sidebar-collapsed": "yes" }),
    ),
    null,
  );
});

test("切换后收起态由切换后的可见态取反（唯一写入路径）", () => {
  // 展开 → 收起：写入 collapsed=true；收起 → 展开：写入 collapsed=false。
  // 这条断言是持久化取反缺陷（收起后刷新又被展开）的回归护栏。
  assert.equal(resolveWorkspaceSidebarCollapsedAfterToggle(false), true);
  assert.equal(resolveWorkspaceSidebarCollapsedAfterToggle(true), false);
});

test("悬浮 banner 只在移动端且侧栏收起时可见", () => {
  assert.equal(
    shouldShowWorkspaceSidebarFloatingBanner({
      mobileViewportMatch: true,
      isSidebarCollapsed: true,
    }),
    true,
  );
  // 展开后 banner 必须隐藏，避免遮挡会话区。
  assert.equal(
    shouldShowWorkspaceSidebarFloatingBanner({
      mobileViewportMatch: true,
      isSidebarCollapsed: false,
    }),
    false,
  );
  // 桌面宽窗口不出现悬浮 banner（角标即入口）。
  assert.equal(
    shouldShowWorkspaceSidebarFloatingBanner({
      mobileViewportMatch: false,
      isSidebarCollapsed: true,
    }),
    false,
  );
});

test("banner 偏移默认左上角且被钳制在视口内", () => {
  const storage = createMemoryStorage();
  assert.deepEqual(
    readWorkspaceSidebarBannerOffset(storage),
    WORKSPACE_SIDEBAR_BANNER_DEFAULT_OFFSET_PX,
  );

  const clamped = clampWorkspaceSidebarBannerOffset({
    offset: { left: 4000, top: -500 },
    viewportWidthPx: 390,
    viewportHeightPx: 844,
    bannerWidthPx: 160,
    bannerHeightPx: 40,
  });
  assert.equal(clamped.left, 390 - 160 - WORKSPACE_SIDEBAR_BANNER_VIEWPORT_INSET_PX);
  assert.equal(clamped.top, WORKSPACE_SIDEBAR_BANNER_VIEWPORT_INSET_PX);

  persistWorkspaceSidebarBannerOffset({ left: 20, top: 30 }, storage);
  assert.deepEqual(readWorkspaceSidebarBannerOffset(storage), { left: 20, top: 30 });
  // 损坏的持久化位置回退默认值而不是 NaN。
  assert.deepEqual(
    readWorkspaceSidebarBannerOffset(
      createMemoryStorage({ "zcode:workspace-shell:sidebar-banner-offset": "{oops" }),
    ),
    WORKSPACE_SIDEBAR_BANNER_DEFAULT_OFFSET_PX,
  );
});

test("拖动位移未超阈值按点击处理", () => {
  assert.equal(isWorkspaceSidebarBannerClick({ movedDistancePx: 0 }), true);
  assert.equal(isWorkspaceSidebarBannerClick({ movedDistancePx: 5.9 }), true);
  assert.equal(isWorkspaceSidebarBannerClick({ movedDistancePx: 6 }), false);
});

test("无 matchMedia 环境按非移动端处理且读取 matchMedia 不抛异常", () => {
  assert.equal(readWorkspaceSidebarMobileViewportMatch(undefined), false);
  assert.equal(
    readWorkspaceSidebarMobileViewportMatch(() => ({ matches: true })),
    true,
  );
  assert.equal(
    readWorkspaceSidebarMobileViewportMatch(() => {
      throw new Error("document is undefined");
    }),
    false,
  );
});
