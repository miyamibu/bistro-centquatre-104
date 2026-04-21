import { z } from "zod";
import { RESERVATION_CONFIG } from "@/lib/reservation-config";
import {
  dateStringSchema,
  reservationServicePeriodSchema,
} from "@/lib/validation/common";

export const createReservationSchema = z.object({
  date: dateStringSchema,
  servicePeriod: reservationServicePeriodSchema,
  partySize: z.coerce.number().int().min(1).max(RESERVATION_CONFIG.maxPartySize),
  arrivalTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm形式で入力してください"),
  name: z.string().trim().min(1, "氏名は必須です").max(80),
  phone: z.string().trim().min(6, "電話番号は必須です").max(32),
  note: z.string().max(2000).optional(),
  lineUserId: z.string().max(128).optional().nullable(),
  course: z.string().max(200).optional(),
});

export const createPrivateBlockSchema = z.object({
  reservationType: z.literal("PRIVATE_BLOCK"),
  privateBlockAccessCode: z.string().trim().min(1, "管理用パスコードは必須です"),
  date: dateStringSchema,
  arrivalTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm形式で入力してください"),
  lastName: z.literal("貸切"),
  firstName: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(32).optional(),
  note: z.string().trim().max(2000).optional(),
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;
export type CreatePrivateBlockInput = z.infer<typeof createPrivateBlockSchema>;
