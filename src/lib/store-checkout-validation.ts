import { validatePayInStoreVisitDate } from "@/lib/order-rules";
import {
  customerInfoSchema,
  ORDER_CUSTOMER_INFO_LIMITS,
} from "@/lib/validation/orders";

export type StoreCheckoutCustomerInfo = {
  name: string;
  email: string;
  phone: string;
  zipCode: string;
  prefecture: string;
  city: string;
  address: string;
  building: string;
};

export type StoreCheckoutPaymentMethod = "BANK_TRANSFER" | "PAY_IN_STORE" | null;

export function validateStoreCheckout(input: {
  customerInfo: StoreCheckoutCustomerInfo;
  paymentMethod: StoreCheckoutPaymentMethod;
  storeVisitDate: string;
}): Record<string, string> {
  const { customerInfo, paymentMethod, storeVisitDate } = input;
  const errors: Record<string, string> = {};
  const trimmed = {
    name: customerInfo.name.trim(),
    email: customerInfo.email.trim(),
    phone: customerInfo.phone.trim(),
    zipCode: customerInfo.zipCode.trim(),
    prefecture: customerInfo.prefecture.trim(),
    city: customerInfo.city.trim(),
    address: customerInfo.address.trim(),
    building: customerInfo.building.trim(),
  };

  if (!trimmed.name) {
    errors["customerInfo.name"] = "お名前を入力してください";
  } else if (trimmed.name.length > ORDER_CUSTOMER_INFO_LIMITS.name) {
    errors["customerInfo.name"] = `お名前は${ORDER_CUSTOMER_INFO_LIMITS.name}文字以内で入力してください`;
  }

  if (!trimmed.email) {
    errors["customerInfo.email"] = "メールアドレスを入力してください";
  } else if (!customerInfoSchema.shape.email.safeParse(trimmed.email).success) {
    errors["customerInfo.email"] = "メールアドレスの形式を確認してください";
  }

  if (!trimmed.phone) {
    errors["customerInfo.phone"] = "電話番号を入力してください";
  } else if (trimmed.phone.length < ORDER_CUSTOMER_INFO_LIMITS.phoneMin) {
    errors["customerInfo.phone"] = `電話番号は${ORDER_CUSTOMER_INFO_LIMITS.phoneMin}文字以上で入力してください`;
  } else if (trimmed.phone.length > ORDER_CUSTOMER_INFO_LIMITS.phone) {
    errors["customerInfo.phone"] = `電話番号は${ORDER_CUSTOMER_INFO_LIMITS.phone}文字以内で入力してください`;
  }

  if (!trimmed.zipCode) {
    errors["customerInfo.zipCode"] = "郵便番号を入力してください";
  } else if (trimmed.zipCode.length > ORDER_CUSTOMER_INFO_LIMITS.zipCode) {
    errors["customerInfo.zipCode"] = `郵便番号は${ORDER_CUSTOMER_INFO_LIMITS.zipCode}文字以内で入力してください`;
  }

  if (!trimmed.prefecture) {
    errors["customerInfo.prefecture"] = "都道府県を選択してください";
  } else if (trimmed.prefecture.length > ORDER_CUSTOMER_INFO_LIMITS.prefecture) {
    errors["customerInfo.prefecture"] = `都道府県は${ORDER_CUSTOMER_INFO_LIMITS.prefecture}文字以内で選択してください`;
  }

  if (!trimmed.city) {
    errors["customerInfo.city"] = "市区町村を入力してください";
  } else if (trimmed.city.length > ORDER_CUSTOMER_INFO_LIMITS.city) {
    errors["customerInfo.city"] = `市区町村は${ORDER_CUSTOMER_INFO_LIMITS.city}文字以内で入力してください`;
  }

  if (!trimmed.address) {
    errors["customerInfo.address"] = "番地を入力してください";
  } else if (trimmed.address.length > ORDER_CUSTOMER_INFO_LIMITS.address) {
    errors["customerInfo.address"] = `番地は${ORDER_CUSTOMER_INFO_LIMITS.address}文字以内で入力してください`;
  }

  if (trimmed.building.length > ORDER_CUSTOMER_INFO_LIMITS.building) {
    errors["customerInfo.building"] = `建物名・部屋番号は${ORDER_CUSTOMER_INFO_LIMITS.building}文字以内で入力してください`;
  }

  if (!paymentMethod) {
    errors.paymentMethod = "支払い方法を選択してください";
  } else if (paymentMethod === "PAY_IN_STORE") {
    const validation = validatePayInStoreVisitDate(storeVisitDate);
    if (!validation.ok) {
      errors.storeVisitDate = validation.error;
    }
  }

  return errors;
}
