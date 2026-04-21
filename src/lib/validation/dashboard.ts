import { ReservationStatus } from "@prisma/client";
import { z } from "zod";
import { dateStringSchema, reservationServicePeriodSchema } from "@/lib/validation/common";

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
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isClosed: z.coerce.boolean().optional().default(false),
  note: z.string().max(300).optional().nullable(),
});

export const updateReservationStatusSchema = z.object({
  status: z.nativeEnum(ReservationStatus),
  operatorName: z.string().trim().max(80).optional(),
});

export const createAdminPrivateBlockSchema = z.object({
  date: dateStringSchema,
  servicePeriod: reservationServicePeriodSchema,
  note: z.string().trim().max(2000).optional().nullable(),
});

