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

export const orderItemInputSchema = z.object({
  id: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(99),
});

export const customerInfoSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email(),
  phone: z.string().trim().min(6).max(32),
  zipCode: z.string().trim().min(1).max(16),
  prefecture: z.string().trim().min(1).max(32),
  city: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(180),
  building: z.string().trim().max(120).optional().or(z.literal("")),
});

export const createOrderSchema = z
  .object({
    items: z.array(orderItemInputSchema).min(1),
    customerInfo: customerInfoSchema,
    paymentMethod: orderPaymentMethodSchema.optional(),
    total: z.coerce.number().int().nonnegative(),
    storeVisitDate: dateStringSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.paymentMethod === "PAY_IN_STORE" && !value.storeVisitDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["storeVisitDate"],
        message: "来店予定日を指定してください",
      });
    }
  });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

