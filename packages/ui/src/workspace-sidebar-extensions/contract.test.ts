import { describe, expect, it } from "vitest";

import { workspaceSidebarExtensionsModule } from "./module.js";
import {
  resolveWorkspaceSidebarCollapsedWidthPx,
  resolveWorkspaceSidebarOverlayMode,
} from "./workspaceSidebarLayout.js";

describe("workspace-sidebar-extensions contract", () => {
  it("declares its module manifest", () => {
    expect(workspaceSidebarExtensionsModule.id).toBe("workspace-sidebar-extensions");
  });

  it("uses overlay only outside the remote-control shell", () => {
    expect(
      resolveWorkspaceSidebarOverlayMode({
        isWebRemoteControlShell: false,
        isSidebarMobileViewport: true,
      }),
    ).toBe(true);
    expect(
      resolveWorkspaceSidebarOverlayMode({
        isWebRemoteControlShell: true,
        isSidebarMobileViewport: true,
      }),
    ).toBe(false);
  });

  it("collapses to zero width in overlay mode and keeps desktop inset otherwise", () => {
    expect(
      resolveWorkspaceSidebarCollapsedWidthPx({
        isOverlayMode: true,
        hasDesktopPanelInset: true,
        isWindowsDesktop: true,
      }),
    ).toBe(0);
    expect(
      resolveWorkspaceSidebarCollapsedWidthPx({
        isOverlayMode: false,
        hasDesktopPanelInset: true,
        isWindowsDesktop: true,
      }),
    ).toBe(6);
    expect(
      resolveWorkspaceSidebarCollapsedWidthPx({
        isOverlayMode: false,
        hasDesktopPanelInset: true,
        isWindowsDesktop: false,
      }),
    ).toBe(4);
  });
});
