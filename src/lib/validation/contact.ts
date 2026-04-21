import { z } from "zod";

export const contactFieldSchemas = {
  name: z
    .string()
    .trim()
    .min(1, "名前を入力してください")
    .max(50, "名前は50文字以内で入力してください"),
  email: z
    .string()
    .trim()
    .min(1, "メールアドレスを入力してください")
    .max(254, "メールアドレスは254文字以内で入力してください")
    .email("メールアドレスの形式が正しくありません"),
  subject: z
    .string()
    .trim()
    .min(1, "件名を入力してください")
    .max(100, "件名は100文字以内で入力してください"),
  message: z
    .string()
    .trim()
    .min(1, "お問い合わせ内容を入力してください")
    .max(1000, "お問い合わせ内容は1000文字以内で入力してください"),
};

export const createContactSchema = z.object(contactFieldSchemas);

export type CreateContactInput = z.infer<typeof createContactSchema>;
