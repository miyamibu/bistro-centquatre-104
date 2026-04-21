import { z } from "zod";
import { dateStringSchema } from "@/lib/validation/common";

export const orderActionNameSchema = z.enum([
  "CONFIRM_HUMAN",
  "SET_PAYMENT_METHOD",
  "MARK_PAID",
  "MARK_COLLECTED",
  "MARK_SHIPPED",
  "CANCEL",
]);

export const normalizedOrderPaymentMethodSchema = z.enum([
  "BANK_TRANSFER",
  "PAY_IN_STORE",
]);

export const confirmHumanPayloadSchema = z.object({
  humanToken: z.string().trim().min(1).max(512),
});

export const setPaymentMethodPayloadSchema = z
  .object({
    paymentMethod: normalizedOrderPaymentMethodSchema,
    storeVisitDate: dateStringSchema.optional(),
    humanToken: z.string().trim().min(1).max(512),
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

export const markPaidPayloadSchema = z.object({
  paymentReference: z.string().trim().regex(/^\d{8}$/, "8桁の参照コードを指定してください"),
  receivedAmount: z.coerce.number().int().nonnegative(),
  adminNote: z.string().trim().max(500).optional(),
});

export const markCollectedPayloadSchema = z.object({
  receivedAmount: z.coerce.number().int().nonnegative(),
  adminNote: z.string().trim().max(500).optional(),
});

export const markShippedPayloadSchema = z.object({
  adminNote: z.string().trim().max(500).optional(),
});

export const cancelOrderPayloadSchema = z.object({
  reasonCode: z.string().trim().min(1).max(100),
  adminNote: z.string().trim().max(500).optional(),
});

export const orderActionRequestSchema = z.object({
  action: orderActionNameSchema,
  expectedVersion: z.coerce.number().int().min(0),
  payload: z.record(z.unknown()).default({}),
});

export type OrderActionName = z.infer<typeof orderActionNameSchema>;
export type NormalizedOrderPaymentMethod = z.infer<typeof normalizedOrderPaymentMethodSchema>;
