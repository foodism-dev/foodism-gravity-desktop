import { describe, expect, test } from "bun:test";

import { formatLogPrefix } from "./logger.ts";

describe("后端日志", () => {
  test("Given 日志级别和时间 When 格式化前缀 Then 输出本地时间和级别", () => {
    const prefix = formatLogPrefix("warn", new Date("2026-06-26T08:09:10.123Z"));

    expect(prefix).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.123\] \[WARN\]$/);
  });
});
