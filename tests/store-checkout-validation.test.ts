import { afterEach, describe, expect, it, vi } from "vitest";
import { validateStoreCheckout } from "@/lib/store-checkout-validation";

const validCustomerInfo = {
  name: "山田太郎",
  email: "taro@example.com",
  phone: "09012345678",
  zipCode: "100-0001",
  prefecture: "東京都",
  city: "千代田区",
  address: "1-1",
  building: "テストビル101",
};

function validate(overrides: Partial<Parameters<typeof validateStoreCheckout>[0]> = {}) {
  return validateStoreCheckout({
    customerInfo: validCustomerInfo,
    paymentMethod: "BANK_TRANSFER",
    storeVisitDate: "",
    ...overrides,
  });
}

describe("validateStoreCheckout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["name", "   ", "customerInfo.name", "お名前を入力してください"],
    ["name", "a".repeat(101), "customerInfo.name", "お名前は100文字以内で入力してください"],
    ["email", "invalid", "customerInfo.email", "メールアドレスの形式を確認してください"],
    ["phone", "12345", "customerInfo.phone", "電話番号は6文字以上で入力してください"],
    ["phone", "1".repeat(33), "customerInfo.phone", "電話番号は32文字以内で入力してください"],
    ["zipCode", "1".repeat(17), "customerInfo.zipCode", "郵便番号は16文字以内で入力してください"],
    ["prefecture", "都".repeat(33), "customerInfo.prefecture", "都道府県は32文字以内で選択してください"],
    ["city", "市".repeat(121), "customerInfo.city", "市区町村は120文字以内で入力してください"],
    ["address", "番".repeat(181), "customerInfo.address", "番地は180文字以内で入力してください"],
    ["building", "建".repeat(121), "customerInfo.building", "建物名・部屋番号は120文字以内で入力してください"],
  ])("validates the server customerInfo constraint for %s", (field, value, key, message) => {
    expect(
      validate({ customerInfo: { ...validCustomerInfo, [field]: value } }),
    ).toMatchObject({ [key]: message });
  });

  it("reports every whitespace-only required field through custom validation", () => {
    const errors = validate({
      customerInfo: {
        name: " ",
        email: " ",
        phone: " ",
        zipCode: " ",
        prefecture: " ",
        city: " ",
        address: " ",
        building: " ",
      },
      paymentMethod: null,
    });

    expect(Object.keys(errors)).toEqual([
      "customerInfo.name",
      "customerInfo.email",
      "customerInfo.phone",
      "customerInfo.zipCode",
      "customerInfo.prefecture",
      "customerInfo.city",
      "customerInfo.address",
      "paymentMethod",
    ]);
  });

  it.each([
    ["", "来店予定日を指定してください"],
    ["2026-08-32", "来店日の形式が不正です"],
    ["2026-08-05", "来店日は営業日（木〜日）を選択してください"],
    ["2026-08-23", "来店日は注文日から14日後〜30日後の範囲で選択してください"],
    ["2026-08-06", undefined],
  ])("validates PAY_IN_STORE date %s", (storeVisitDate, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T03:00:00.000Z"));

    expect(
      validate({ paymentMethod: "PAY_IN_STORE", storeVisitDate }).storeVisitDate,
    ).toBe(expected);
  });
});
