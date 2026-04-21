import { z } from "zod";

export const pdfToImageSchema = z.object({
  filePath: z.string().trim().min(1).max(300),
});

export type PdfToImageInput = z.infer<typeof pdfToImageSchema>;

