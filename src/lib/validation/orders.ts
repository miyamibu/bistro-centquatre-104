import { z } from "zod";
import { dateStringSchema } from "@/lib/validation/common";

export const orderPaymentMethodSchema = z.enum(["BANK_TRANSFER", "PAY_IN_STORE"]);
export const orderStatusSchema = z.enum([
  "QUOTED",
  "PENDING_PAYMENT",
  "PAID",
  "SHIPPED",
  "CANCELLED",
]);

export const ORDER_CUSTOMER_INFO_LIMITS = {
  name: 100,
  phoneMin: 6,
  phone: 32,
  zipCode: 16,
  prefecture: 32,
  city: 120,
  address: 180,
  building: 120,
} as const;

export const ORDER_ITEM_LIMITS = {
  maxDistinctItems: 20,
  maxTotalQuantity: 99,
} as const;

export const orderItemInputSchema = z.object({
  id: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(99),
});

export const customerInfoSchema = z.object({
  name: z.string().trim().min(1).max(ORDER_CUSTOMER_INFO_LIMITS.name),
  email: z.string().trim().email(),
  phone: z.string().trim().min(ORDER_CUSTOMER_INFO_LIMITS.phoneMin).max(ORDER_CUSTOMER_INFO_LIMITS.phone),
  zipCode: z.string().trim().min(1).max(ORDER_CUSTOMER_INFO_LIMITS.zipCode),
  prefecture: z.string().trim().min(1).max(ORDER_CUSTOMER_INFO_LIMITS.prefecture),
  city: z.string().trim().min(1).max(ORDER_CUSTOMER_INFO_LIMITS.city),
  address: z.string().trim().min(1).max(ORDER_CUSTOMER_INFO_LIMITS.address),
  building: z.string().trim().max(ORDER_CUSTOMER_INFO_LIMITS.building).optional().or(z.literal("")),
});

export const createOrderSchema = z
  .object({
    items: z.array(orderItemInputSchema).min(1).max(ORDER_ITEM_LIMITS.maxDistinctItems),
    customerInfo: customerInfoSchema,
    paymentMethod: orderPaymentMethodSchema.optional(),
    total: z.coerce.number().int().nonnegative(),
    storeVisitDate: dateStringSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const totalQuantity = value.items.reduce((sum, item) => sum + item.quantity, 0);
    if (totalQuantity > ORDER_ITEM_LIMITS.maxTotalQuantity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: `商品の合計数量は${ORDER_ITEM_LIMITS.maxTotalQuantity}個以内で指定してください`,
      });
    }

    if (value.paymentMethod === "PAY_IN_STORE" && !value.storeVisitDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["storeVisitDate"],
        message: "来店予定日を指定してください",
      });
    }
  });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

