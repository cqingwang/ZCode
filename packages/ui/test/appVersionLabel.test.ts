// 使用统计标题行应用版本号展示的领域规则回归测试。
// 覆盖：纯数字补 v 前缀、已有 v/V 前缀不重复、空白裁剪、空值回退占位符。
import assert from "node:assert/strict";
import test from "node:test";
import { resolveAppVersionLabel } from "../src/lib/appVersionLabel.ts";

test("纯数字版本号补 v 前缀", () => {
  assert.equal(resolveAppVersionLabel("3.14.3"), "v3.14.3");
});

test("已有 v 前缀不重复补前缀", () => {
  assert.equal(resolveAppVersionLabel("v3.14.3"), "v3.14.3");
});

test("大写 V 前缀归一为小写 v", () => {
  assert.equal(resolveAppVersionLabel("V3.14.3"), "v3.14.3");
});

test("裁剪首尾空白后再归一化", () => {
  assert.equal(resolveAppVersionLabel("  3.14.3  "), "v3.14.3");
});

test("空值回退占位符", () => {
  assert.equal(resolveAppVersionLabel(null), "--");
  assert.equal(resolveAppVersionLabel(undefined), "--");
  assert.equal(resolveAppVersionLabel("   "), "--");
});
