import { describe, expect, test } from "bun:test";

import {
  allCommissionTrafficSources,
  applyDefaultCommissionRate,
  normalizeLinkeCommission,
  validateLinkeCommission,
  type CommissionRateValues,
} from "./linke-fee-rates.ts";

describe("林客费用比例表单逻辑", () => {
  test("Given default input is empty, When active table fields are filled, Then validation passes", () => {
    const values = commissionValues();

    expect(applyDefaultCommissionRate(values, "")).toEqual(values);
    expect(validateLinkeCommission(values)).toBe("");
  });

  test("Given an active table field is empty, When validating, Then that field is required", () => {
    expect(validateLinkeCommission(commissionValues({ values: { "2000": "" } }))).toBe("请填写直播费用比例");
    expect(validateLinkeCommission(commissionValues({
      singleSettings: { "1000": true },
      values: { "1001": "1.00", "1002": "", "1003": "3.00" },
    }))).toBe("请填写达人视频费用比例");
  });

  test("Given default fill is used, When rows have single setting enabled, Then opened children are not overwritten", () => {
    const values = commissionValues({
      singleSettings: { "1000": true, "7000": true },
      values: {
        "1001": "1.00",
        "1002": "2.00",
        "1003": "3.00",
        "7001": "4.00",
        "7002": "5.00",
        "7003": "6.00",
      },
    });

    const nextValues = applyDefaultCommissionRate(values, "12");

    expect(nextValues.values["1001"]).toBe("1.00");
    expect(nextValues.values["1002"]).toBe("2.00");
    expect(nextValues.values["1003"]).toBe("3.00");
    expect(nextValues.values["2000"]).toBe("12");
    expect(nextValues.values["3000"]).toBe("12");
    expect(nextValues.values["4000"]).toBe("12");
    expect(nextValues.values["5000"]).toBe("12");
    expect(nextValues.values["7001"]).toBe("4.00");
    expect(nextValues.values["7002"]).toBe("5.00");
    expect(nextValues.values["7003"]).toBe("6.00");
    expect(nextValues.values["7100"]).toBe("12");
  });

  test("Given opened rows, When normalizing for API, Then only active table fields are submitted", () => {
    const values = commissionValues({
      singleSettings: { "1000": true, "7000": true },
      values: {
        "1000": "99.00",
        "1001": "1.00",
        "1002": "2.00",
        "1003": "3.00",
        "2000": "12.00",
        "3000": "12.00",
        "4000": "12.00",
        "5000": "12.00",
        "7000": "99.00",
        "7001": "4.00",
        "7002": "5.00",
        "7003": "6.00",
        "7100": "15.00",
      },
    });

    expect(normalizeLinkeCommission(values)).toEqual({
      values: {
        "1001": 1,
        "1002": 2,
        "1003": 3,
        "2000": 12,
        "3000": 12,
        "4000": 12,
        "5000": 12,
        "7001": 4,
        "7002": 5,
        "7003": 6,
        "7100": 15,
      },
      singleSettings: {
        "1000": true,
        "2000": false,
        "3000": false,
        "5000": false,
        "7000": true,
      },
    });
  });
});

function commissionValues(patch: {
  values?: Record<string, string>;
  singleSettings?: Record<string, boolean>;
} = {}): CommissionRateValues {
  return {
    values: {
      ...Object.fromEntries(allCommissionTrafficSources().map((field) => [field.source, "0.00"])),
      ...patch.values,
    },
    singleSettings: {
      "1000": false,
      "2000": false,
      "3000": false,
      "5000": false,
      "7000": false,
      ...patch.singleSettings,
    },
  };
}
