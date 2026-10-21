# workspace-sidebar-extensions

左侧任务栏收起/展开的本地增强层。上游只提供基础 toggle；本模块补移动端抽屉、
延边角标、悬浮 banner 与收起偏好持久化。

不变量：

- `useWorkspaceSidebarVisibility` 是 `isSidebarVisible` 的唯一所有者；渲染层不得另存副本。
- 收起偏好只在用户显式切换后写入，首帧默认值不写盘，保证移动端默认收起规则可复用。
- 远控壳在移动端使用顶部导航，`isSidebarOverlayMode` 必须为 false。
- 覆盖层收起宽度恒为 0，桌面端保留 4px / Windows 6px 外沿。
