import { ReservationStatus, ReservationType } from "@prisma/client";
import { z } from "zod";
import {
  dateStringSchema,
  reservationServicePeriodSchema,
} from "@/lib/validation/common";
import { RESERVATION_CONFIG } from "@/lib/reservation-config";

export const updateOrderStatusSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(["QUOTED", "PENDING_PAYMENT", "PAID", "SHIPPED"]),
});

export const deleteOrderSchema = z.object({
  orderId: z.string().min(1),
});

export const saveBankAccountSchema = z.object({
  id: z.string().min(1).optional(),
  bank_name: z.string().trim().min(1).max(100),
  branch_name: z.string().trim().min(1).max(100),
  account_type: z.string().trim().min(1).max(20),
  account_number: z.string().trim().min(1).max(30),
  account_holder: z.string().trim().min(1).max(100),
});

export const deleteBankAccountSchema = z.object({
  id: z.string().min(1),
});

export const upsertBusinessDaySchema = z.object({
  date: dateStringSchema,
  isClosed: z.boolean().optional().default(false),
  note: z.string().max(300).optional().nullable(),
  force: z.boolean().optional().default(false),
  reason: z.string().trim().max(500).optional().nullable(),
});

const reservationTargetSchema = z.object({
  date: dateStringSchema,
  servicePeriod: reservationServicePeriodSchema,
  reservationType: z.nativeEnum(ReservationType),
});

export const updateReservationStatusSchema = z.object({
  status: z.nativeEnum(ReservationStatus),
  operatorName: z.string().trim().max(80).optional(),
  reason: z.string().trim().max(500).optional(),
  date: dateStringSchema.optional(),
  servicePeriod: reservationServicePeriodSchema.optional(),
  reservationType: z.nativeEnum(ReservationType).optional(),
  expectedDate: dateStringSchema.optional(),
  expectedServicePeriod: reservationServicePeriodSchema.optional(),
  expectedReservationType: z.nativeEnum(ReservationType).optional(),
  expected: reservationTargetSchema.optional(),
});

const adminReservationCorrectionFieldSchema = z.object({
  date: dateStringSchema.optional(),
  servicePeriod: reservationServicePeriodSchema.optional(),
  partySize: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(RESERVATION_CONFIG.maxPartySize)
    .optional(),
  arrivalTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm形式で入力してください")
    .nullable()
    .optional(),
  name: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().min(6).max(32).optional(),
  note: z.string().max(2000).nullable().optional(),
});

export const updateAdminReservationSchema = adminReservationCorrectionFieldSchema
  .extend({
    reason: z.string().trim().min(1, "訂正理由は必須です").max(500),
    expectedUpdatedAt: z.string().datetime().optional(),
  })
  .superRefine((value, ctx) => {
    const hasCorrectionField = Object.entries(value)
      .filter(([key]) => key !== "reason" && key !== "expectedUpdatedAt")
      .some(([, field]) => field !== undefined);
    if (!hasCorrectionField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["root"],
        message: "訂正項目を1つ以上指定してください",
      });
    }
  });

export const createAdminPrivateBlockSchema = z.object({
  date: dateStringSchema,
  servicePeriod: reservationServicePeriodSchema,
  note: z.string().trim().max(2000).optional().nullable(),
});

