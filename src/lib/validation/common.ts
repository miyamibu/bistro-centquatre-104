import { ZodError, z } from "zod";

export const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD形式で入力してください");
export const monthStringSchema = z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM形式で入力してください");
export const reservationServicePeriodSchema = z.enum(["LUNCH", "DINNER"]);

export function zodFields(error: ZodError): Record<string, string> {
  const output: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "root";
    if (!output[key]) {
      output[key] = issue.message;
    }
  }
  return output;
}

