/**
 * 左侧抽拉侧栏收起/展开交互的浏览器验收脚本（可重复执行）。
 *
 * 前置条件：
 *   1. `pnpm --filter @zcode/web build` 已产出 packages/web/dist；
 *   2. zcode.service 正在监听（默认 http://127.0.0.1:3030），
 *      鉴权 token 走 `?token=` 换 Cookie（见 docs/engineering-memory.md）。
 * 可用 ZCODE_E2E_BASE_URL / ZCODE_E2E_TOKEN_FILE / ZCODE_E2E_CHROME 覆盖默认值。
 *
 * 断言全部基于真实 DOM 几何与 localStorage，退出码非 0 即验收失败。
 * 鼠标与触摸两条输入路径都要覆盖：触摸的 touchend→click 会按坐标重新命中，
 * 只测 mouse 会漏掉“展开后遮罩立刻吞掉 click”这类只在真机出现的缺陷。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const baseUrl = process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:3030";
const tokenFile = process.env.ZCODE_E2E_TOKEN_FILE ?? "/etc/zcode/zcode.env";
const chromePath = process.env.ZCODE_E2E_CHROME ?? "/usr/bin/google-chrome-stable";

const collapsedWidthEpsilonPx = 1;
const expandedSidebarWidthPx = 264;
// 悬浮按钮是 44x44 的单图标圆钮，命中点取中心。
const bannerHitCenterPx = { x: 22, y: 22 };

function readToken() {
  if (process.env.ZCODE_E2E_TOKEN) {
    return process.env.ZCODE_E2E_TOKEN;
  }
  // 凭据文件 root 所有（见工程记忆「凭据外置」），非 root 走 sudo -n 读取。
  let raw = "";
  try {
    raw = execFileSync("cat", [tokenFile], { encoding: "utf8" });
  } catch {
    raw = execFileSync("sudo", ["-n", "cat", tokenFile], { encoding: "utf8" });
  }
  const matched = raw.match(/ZCODE_SERVER_AUTH_TOKEN=(.+)/);
  assert.ok(matched, `token 文件 ${tokenFile} 缺少 ZCODE_SERVER_AUTH_TOKEN`);
  return matched[1].trim();
}

/**
 * 侧栏与右侧会话输入框的重叠区是否被输入框反压。
 *
 * 层级缺陷的判定必须以命中测试为准：composer 作为 flex item 自带 z-20 stacking context，
 * 且 #content 在 DOM 里位于侧栏之后，同层时输入框会绘制在抽屉之上。
 */
async function readSidebarOcclusion(page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector("#sidebar");
    const scrim = document.querySelector('[data-testid="workspace-sidebar-overlay-scrim"]');
    const sidebarRect = sidebar.getBoundingClientRect();
    const composer = document.querySelector(".chat-composer-region")?.getBoundingClientRect();
    // 遮罩本身也在重叠区之上，会干扰“抽屉 vs 输入框”的绘制次序判定；
    // 取样期间临时隐藏，只测两者的相对层级。
    const previousDisplay = scrim ? scrim.style.display : null;
    if (scrim) {
      scrim.style.display = "none";
    }
    let samples = 0;
    let occluded = 0;
    const offenders = [];
    const xStart = Math.max(0, Math.round(composer?.left ?? 0));
    const xEnd = Math.round(sidebarRect.right);
    for (let x = xStart + 4; x < xEnd; x += 6) {
      for (let y = 120; y < Math.round(sidebarRect.bottom) - 8; y += 28) {
        const element = document.elementFromPoint(x, y);
        if (!element) {
          continue;
        }
        samples += 1;
        if (!sidebar.contains(element)) {
          occluded += 1;
          if (offenders.length < 3) {
            offenders.push({ x, y, tag: element.tagName });
          }
        }
      }
    }
    if (scrim) {
      scrim.style.display = previousDisplay ?? "";
    }
    return {
      samples,
      occluded,
      offenders,
      sidebarZ: Number(getComputedStyle(sidebar).zIndex),
      scrimZ: scrim ? Number(getComputedStyle(scrim).zIndex) : null,
    };
  });
}

async function readGeometry(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) {
        return null;
      }
      const box = element.getBoundingClientRect();
      return {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
        hidden: getComputedStyle(element).opacity === "0",
      };
    };
    return {
      panel: rect("#sidebar"),
      tab: rect('[data-testid="workspace-sidebar-collapse-tab"]'),
      banner: rect('[data-testid="workspace-sidebar-floating-banner"]'),
      scrim: rect('[data-testid="workspace-sidebar-overlay-scrim"]'),
      storedCollapsed: localStorage.getItem("zcode:workspace-shell:sidebar-collapsed"),
      storedBannerOffset: localStorage.getItem("zcode:workspace-shell:sidebar-banner-offset"),
    };
  });
}

const results = [];
function check(label, passed, snapshot) {
  results.push({ label, passed });
  console.log(
    `${passed ? "PASS" : "FAIL"} ${label}${passed ? "" : ` :: ${JSON.stringify(snapshot)}`}`,
  );
}

const isCollapsed = (geometry) => (geometry.panel?.width ?? 99) <= collapsedWidthEpsilonPx;

const browser = await chromium.launch({
  executablePath: chromePath,
  args: ["--no-sandbox", "--headless=new", "--disable-dev-shm-usage"],
});
const url = `${baseUrl}/?token=${readToken()}`;

async function openFreshPage(context, { collapsedPreference }) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate((preference) => {
    localStorage.clear();
    if (preference !== null) {
      localStorage.setItem("zcode:workspace-shell:sidebar-collapsed", preference);
    }
  }, collapsedPreference);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  return page;
}

// ---------- 桌面宽窗口：角标是唯一入口 ----------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await openFreshPage(context, { collapsedPreference: null });

  let geometry = await readGeometry(page);
  check("desktop: 首帧侧栏展开", geometry.panel?.width === expandedSidebarWidthPx, geometry);
  check(
    "desktop: 角标可见并贴侧栏右延边",
    !geometry.tab?.hidden && Math.abs(geometry.tab.x - expandedSidebarWidthPx) <= 1,
    geometry,
  );
  check("desktop: 宽窗口不出现悬浮按钮", geometry.banner === null, geometry);

  await page.click('[data-testid="workspace-sidebar-collapse-tab"]');
  await page.waitForTimeout(500);
  geometry = await readGeometry(page);
  check("desktop: 点角标收起侧栏", isCollapsed(geometry), geometry);
  check(
    "desktop: 收起态角标回到窗口左边缘",
    !geometry.tab?.hidden && geometry.tab.x <= 5,
    geometry,
  );
  check("desktop: 收起偏好写入 collapsed=true", geometry.storedCollapsed === "true", geometry);
  check("desktop: 收起态不出现悬浮按钮", geometry.banner === null, geometry);

  await page.click('[data-testid="workspace-sidebar-collapse-tab"]');
  await page.waitForTimeout(500);
  geometry = await readGeometry(page);
  check(
    "desktop: 再点角标恢复展开",
    geometry.panel?.width === expandedSidebarWidthPx && geometry.storedCollapsed === "false",
    geometry,
  );
  await context.close();
}

// ---------- 移动端屏幕（鼠标输入）：抽屉 + 悬浮按钮 ----------
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await openFreshPage(context, { collapsedPreference: null });

  let geometry = await readGeometry(page);
  check("mobile: 无偏好时首帧默认收起", isCollapsed(geometry), geometry);
  check(
    "mobile: 悬浮按钮默认左上角（顶部浮层下方）",
    geometry.banner?.x === 12 && geometry.banner?.y === 68,
    geometry,
  );
  check(
    "mobile: 悬浮按钮为单图标（不多图标并排）",
    (await page.locator('[data-testid="workspace-sidebar-floating-banner"] > *').count()) === 1,
    geometry,
  );
  check(
    "mobile: 收起态隐藏角标，入口唯一",
    geometry.tab === null || geometry.tab.hidden === true,
    geometry,
  );

  const bannerBox = geometry.banner;
  await page.mouse.move(bannerBox.x + bannerHitCenterPx.x, bannerBox.y + bannerHitCenterPx.y);
  await page.mouse.down();
  await page.mouse.move(bannerBox.x + 240, bannerBox.y + 500, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  geometry = await readGeometry(page);
  check(
    "mobile: 按钮可拖动且位置持久化",
    (geometry.banner?.x ?? 0) > 100 && geometry.storedBannerOffset !== null,
    geometry,
  );
  check("mobile: 拖动结束的 click 不误触发展开", isCollapsed(geometry), geometry);

  const dragged = geometry.banner;
  await page.mouse.click(dragged.x + bannerHitCenterPx.x, dragged.y + bannerHitCenterPx.y);
  await page.waitForTimeout(600);
  geometry = await readGeometry(page);
  check(
    "mobile: 点按钮以覆盖层展开侧栏",
    geometry.panel?.width === expandedSidebarWidthPx,
    geometry,
  );
  check("mobile: 展开后按钮隐藏", geometry.banner === null, geometry);
  check("mobile: 展开态出现遮罩层", geometry.scrim?.width === 390, geometry);

  // 层级回归护栏：抽屉必须压在会话输入框之上，否则侧栏视图元素会被输入框遮住一部分。
  const occlusion = await readSidebarOcclusion(page);
  check(
    "mobile: 展开的侧栏不被会话输入框遮挡（层级高于 composer z-20）",
    occlusion.samples > 0 && occlusion.occluded === 0,
    occlusion,
  );
  // 层级阶梯：会话内容/composer(20) < 遮罩 < 抽屉；遮罩必须夹在中间才能既点空白收起又不吃掉抽屉。
  check(
    "mobile: 遮罩夹在会话内容与抽屉之间（20 < scrim < sidebar）",
    occlusion.scrimZ !== null && occlusion.scrimZ > 20 && occlusion.scrimZ < occlusion.sidebarZ,
    occlusion,
  );
  check(
    "mobile: 展开态角标可见（收起入口）",
    !geometry.tab?.hidden && Math.abs(geometry.tab.x - expandedSidebarWidthPx) <= 1,
    geometry,
  );

  await page.click('[data-testid="workspace-sidebar-collapse-tab"]');
  await page.waitForTimeout(600);
  geometry = await readGeometry(page);
  check(
    "mobile: 点角标收起后按钮重新出现",
    isCollapsed(geometry) && geometry.banner !== null,
    geometry,
  );
  check("mobile: 按钮沿用上次拖动位置", (geometry.banner?.x ?? 0) > 100, geometry);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  geometry = await readGeometry(page);
  check(
    "mobile: 刷新后保持收起且按钮可见",
    isCollapsed(geometry) && geometry.banner !== null,
    geometry,
  );

  await page.click('[data-testid="workspace-sidebar-floating-banner"]');
  await page.waitForTimeout(600);
  await page.mouse.click(350, 700);
  await page.waitForTimeout(600);
  geometry = await readGeometry(page);
  check("mobile: 点遮罩收起侧栏", isCollapsed(geometry) && geometry.banner !== null, geometry);
  await context.close();
}

// ---------- 移动端屏幕（触摸输入：手机浏览器/设备模拟的真实输入路径） ----------
// 回归护栏：展开动作曾写在 pointerup 里，触摸的 touchend→click 会按坐标重新命中，
// 此时遮罩已先挂载并把侧栏再次收起，用户看到“点悬浮按钮侧栏无任何反应”。
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await openFreshPage(context, { collapsedPreference: "true" });

  let geometry = await readGeometry(page);
  check("touch: 收起态悬浮按钮可见", isCollapsed(geometry) && geometry.banner !== null, geometry);

  await page.tap('[data-testid="workspace-sidebar-floating-banner"]');
  await page.waitForTimeout(700);
  geometry = await readGeometry(page);
  check(
    "touch: tap 按钮展开侧栏（缺陷回归护栏）",
    geometry.panel?.width === expandedSidebarWidthPx,
    geometry,
  );
  check("touch: 展开后按钮隐藏", geometry.banner === null, geometry);
  const touchOcclusion = await readSidebarOcclusion(page);
  check(
    "touch: 触摸展开后侧栏同样不被输入框遮挡",
    touchOcclusion.samples > 0 && touchOcclusion.occluded === 0,
    touchOcclusion,
  );

  await page.tap('[data-testid="workspace-sidebar-collapse-tab"]');
  await page.waitForTimeout(700);
  geometry = await readGeometry(page);
  check(
    "touch: tap 角标收起后按钮重新出现",
    isCollapsed(geometry) && geometry.banner !== null,
    geometry,
  );

  const box = geometry.banner;
  await page.touchscreen.tap(box.x + bannerHitCenterPx.x, box.y + bannerHitCenterPx.y);
  await page.waitForTimeout(700);
  geometry = await readGeometry(page);
  check("touch: 坐标 tap 同样展开侧栏", geometry.panel?.width === expandedSidebarWidthPx, geometry);
  await context.close();
}

await browser.close();
const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length > 0) {
  process.exitCode = 1;
}
