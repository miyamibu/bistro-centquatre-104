"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { contactFieldSchemas, createContactSchema, zodFields } from "@/lib/validation";

type ContactField = keyof typeof contactFieldSchemas;
type ContactValues = Record<ContactField, string>;
type ContactErrors = Partial<Record<ContactField, string>>;

const initialValues: ContactValues = {
  name: "",
  email: "",
  subject: "",
  message: "",
};

const submitErrorMessage = "送信に失敗しました。時間をおいて再度お試しください。";
const submitSuccessMessage = "お問い合わせを受け付けました。内容を確認のうえ、後日ご連絡いたします。";

const fieldOrder: ContactField[] = ["name", "email", "subject", "message"];

function getFieldError(field: ContactField, value: string) {
  const parsed = contactFieldSchemas[field].safeParse(value);
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

function getValidationResult(values: ContactValues) {
  const parsed = createContactSchema.safeParse(values);
  if (parsed.success) {
    return {
      values: parsed.data,
      errors: {} as ContactErrors,
    };
  }

  return {
    values: null,
    errors: zodFields(parsed.error) as ContactErrors,
  };
}

function mergeFieldError(errors: ContactErrors, field: ContactField, nextError?: string) {
  if (!nextError) {
    const next = { ...errors };
    delete next[field];
    return next;
  }

  return {
    ...errors,
    [field]: nextError,
  };
}

export function ContactForm() {
  const [values, setValues] = useState<ContactValues>(initialValues);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [didAttemptSubmit, setDidAttemptSubmit] = useState(false);

  const hasSummaryError = fieldOrder.some((field) => !!errors[field]);

  function updateField(field: ContactField, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    setSubmitSuccess(false);

    if (!didAttemptSubmit && !errors[field]) return;

    const nextError = getFieldError(field, value);
    setErrors((prev) => mergeFieldError(prev, field, nextError));
  }

  function validateField(field: ContactField) {
    const nextError = getFieldError(field, values[field]);
    setErrors((prev) => mergeFieldError(prev, field, nextError));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setDidAttemptSubmit(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    const validation = getValidationResult(values);
    setErrors(validation.errors);

    if (!validation.values) {
      return;
    }

    setIsSubmitting(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify(validation.values),
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            fields?: ContactErrors;
            error?: string;
          }
        | null;

      if (!response.ok) {
        if (payload?.fields) {
          setErrors(payload.fields);
        }
        setSubmitError(payload?.error ?? submitErrorMessage);
        return;
      }

      setValues(initialValues);
      setErrors({});
      setSubmitSuccess(true);
      setDidAttemptSubmit(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setSubmitError(submitErrorMessage);
      } else {
        setSubmitError(submitErrorMessage);
      }
    } finally {
      clearTimeout(timeoutId);
      setIsSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-6">
      {submitError ? (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-xl border border-[#b32626]/25 bg-[#fff1f1] px-4 py-3 text-sm text-[#b32626]"
        >
          {submitError}
        </div>
      ) : null}

      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="contact-name" className="flex items-center gap-2 text-[#2f1b0f]">
            名前
            <span className="rounded-full bg-[#b32626]/10 px-2 py-0.5 text-[11px] font-semibold text-[#b32626]">
              必須
            </span>
          </Label>
          <Input
            id="contact-name"
            name="name"
            autoComplete="name"
            value={values.name}
            maxLength={50}
            onChange={(event) => updateField("name", event.target.value)}
            onBlur={() => validateField("name")}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "contact-name-error" : undefined}
            className="h-11 border-[#cfa96d]/45 bg-white text-[#2f1b0f] focus:border-[#c7a357] focus:ring-[#c7a357]/30"
            style={errors.name ? { borderColor: "#b32626" } : undefined}
          />
          {errors.name ? (
            <p id="contact-name-error" className="text-sm text-[#b32626]">
              {errors.name}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="contact-email" className="flex items-center gap-2 text-[#2f1b0f]">
            メールアドレス
            <span className="rounded-full bg-[#b32626]/10 px-2 py-0.5 text-[11px] font-semibold text-[#b32626]">
              必須
            </span>
          </Label>
          <Input
            id="contact-email"
            name="email"
            type="email"
            autoComplete="email"
            value={values.email}
            maxLength={254}
            onChange={(event) => updateField("email", event.target.value)}
            onBlur={() => validateField("email")}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "contact-email-error" : undefined}
            className="h-11 border-[#cfa96d]/45 bg-white text-[#2f1b0f] focus:border-[#c7a357] focus:ring-[#c7a357]/30"
            style={errors.email ? { borderColor: "#b32626" } : undefined}
          />
          {errors.email ? (
            <p id="contact-email-error" className="text-sm text-[#b32626]">
              {errors.email}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="contact-subject" className="flex items-center gap-2 text-[#2f1b0f]">
            件名
            <span className="rounded-full bg-[#b32626]/10 px-2 py-0.5 text-[11px] font-semibold text-[#b32626]">
              必須
            </span>
          </Label>
          <Input
            id="contact-subject"
            name="subject"
            autoComplete="off"
            value={values.subject}
            maxLength={100}
            onChange={(event) => updateField("subject", event.target.value)}
            onBlur={() => validateField("subject")}
            aria-invalid={!!errors.subject}
            aria-describedby={errors.subject ? "contact-subject-error" : undefined}
            className="h-11 border-[#cfa96d]/45 bg-white text-[#2f1b0f] focus:border-[#c7a357] focus:ring-[#c7a357]/30"
            style={errors.subject ? { borderColor: "#b32626" } : undefined}
          />
          {errors.subject ? (
            <p id="contact-subject-error" className="text-sm text-[#b32626]">
              {errors.subject}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="contact-message" className="flex items-center gap-2 text-[#2f1b0f]">
            お問い合わせ内容
            <span className="rounded-full bg-[#b32626]/10 px-2 py-0.5 text-[11px] font-semibold text-[#b32626]">
              必須
            </span>
          </Label>
          <Textarea
            id="contact-message"
            name="message"
            value={values.message}
            maxLength={1000}
            onChange={(event) => updateField("message", event.target.value)}
            onBlur={() => validateField("message")}
            aria-invalid={!!errors.message}
            aria-describedby={errors.message ? "contact-message-error" : undefined}
            className="min-h-[180px] border-[#cfa96d]/45 bg-white text-[#2f1b0f] focus:border-[#c7a357] focus:ring-[#c7a357]/30"
            style={errors.message ? { borderColor: "#b32626" } : undefined}
          />
          {errors.message ? (
            <p id="contact-message-error" className="text-sm text-[#b32626]">
              {errors.message}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        {hasSummaryError ? (
          <div
            role="alert"
            aria-live="assertive"
            className="rounded-xl border border-[#b32626]/20 bg-[#fff7f7] px-4 py-3 text-sm font-medium text-[#b32626]"
          >
            入力内容を確認してください
          </div>
        ) : null}

        <Button
          type="submit"
          disabled={isSubmitting}
          className="h-11 w-full rounded-full bg-[#2f1b0f] text-sm tracking-[0.18em] text-white hover:bg-[#4a3121] focus-visible:outline-[#2f1b0f]"
        >
          {isSubmitting ? "送信中..." : "送信する"}
        </Button>

        <p className="text-sm leading-6 text-[#6b5644]">
          ご入力いただいた内容は、お問い合わせ対応以外の目的では使用しません。
        </p>
      </div>

      {submitSuccess ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-[#c7a357]/30 bg-[#fff7e6] px-4 py-3 text-sm text-[#4a3121]"
        >
          {submitSuccessMessage}
        </div>
      ) : null}
    </form>
  );
}
