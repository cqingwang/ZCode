/**
 * 归一化用于展示的应用版本号。
 *
 * 版本常量可能来自构建元数据（桌面端 appVersion）或根 package.json（Web 端），
 * 既可能是 `3.14.3` 也可能是 `v3.14.3`。展示口径统一为小写 `v` 前缀，
 * 空值回退占位符，避免标题行出现空白或 `v` 重复。
 */
export function resolveAppVersionLabel(rawVersion: string | null | undefined): string {
  const trimmedVersion = rawVersion?.trim();
  if (!trimmedVersion) {
    return "--";
  }
  return trimmedVersion.startsWith("v") || trimmedVersion.startsWith("V")
    ? `v${trimmedVersion.slice(1)}`
    : `v${trimmedVersion}`;
}
