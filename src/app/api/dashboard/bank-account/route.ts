import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/basic-auth";
import { encryptBankHistoryValue } from "@/lib/bank-account-history-crypto";
import { env } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase-server";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import {
  deleteBankAccountSchema,
  saveBankAccountSchema,
  zodFields,
} from "@/lib/validation";
import { getRequestId, logError, logInfo } from "@/lib/logger";

export const dynamic = "force-dynamic";

function unauthorized(requestId: string) {
  return apiError(401, {
    error: "Unauthorized",
    code: "UNAUTHORIZED",
    requestId,
  });
}

type BankAccountRecord = {
  id: string;
  bank_name: string;
  branch_name: string;
  account_type: string;
  account_number: string;
  account_holder: string;
};

async function appendBankAccountHistory(input: {
  bankAccount: BankAccountRecord;
  actionType: "UPDATED" | "DELETED";
  requestId: string;
}) {
  const encryptedAccountNumber = encryptBankHistoryValue(input.bankAccount.account_number);
  const encryptedAccountHolder = encryptBankHistoryValue(input.bankAccount.account_holder);

  const { error } = await supabaseServer.from("bank_account_history").insert([
    {
      bank_account_id: input.bankAccount.id,
      action_type: input.actionType,
      changed_by: "admin",
      bank_name: input.bankAccount.bank_name,
      branch_name: input.bankAccount.branch_name,
      account_type: input.bankAccount.account_type,
      account_number_last4: input.bankAccount.account_number.slice(-4),
      account_number_enc: encryptedAccountNumber.ciphertext,
      account_holder_enc: encryptedAccountHolder.ciphertext,
      account_number_nonce: encryptedAccountNumber.nonce,
      account_number_auth_tag: encryptedAccountNumber.authTag,
      account_holder_nonce: encryptedAccountHolder.nonce,
      account_holder_auth_tag: encryptedAccountHolder.authTag,
      key_version: env.BANK_ACCOUNT_HISTORY_KEY_VERSION,
    },
  ]);

  if (error) {
    logError("dashboard.bank_account.history.failed", {
      requestId: input.requestId,
      route: "/api/dashboard/bank-account",
      errorCode: "DASHBOARD_BANK_ACCOUNT_HISTORY_FAILED",
      context: { message: error.message, actionType: input.actionType },
    });
    throw new Error("DASHBOARD_BANK_ACCOUNT_HISTORY_FAILED");
  }
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const route = "/api/dashboard/bank-account";

  if (!isAuthorized(request)) {
    return unauthorized(requestId);
  }

  try {
    const { data, error } = await supabaseServer.from("bank_account").select("*").limit(1);
    if (error) throw error;
    return NextResponse.json(data?.[0] || {});
  } catch (error) {
    logError("dashboard.bank_account.fetch.failed", {
      requestId,
      route,
      errorCode: "DASHBOARD_BANK_ACCOUNT_FETCH_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Failed to fetch bank account",
      code: "DASHBOARD_BANK_ACCOUNT_FETCH_FAILED",
      requestId,
    });
  }
}

export async function PUT(request: NextRequest) {
  const requestId = getRequestId(request);
  const route = "/api/dashboard/bank-account";

  if (!isAuthorized(request)) {
    return unauthorized(requestId);
  }

  const securityError = enforceWriteRequestSecurity(request, { requestId });
  if (securityError) return securityError;

  try {
    const body = await request.json().catch(() => null);
    const parsed = saveBankAccountSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(400, {
        error: "入力内容が不正です",
        code: "VALIDATION_ERROR",
        fields: zodFields(parsed.error),
        requestId,
      });
    }

    const payload = parsed.data;
    const { id, ...upsertData } = payload;

    let bankAccount: BankAccountRecord | undefined;
    if (id) {
      const { data, error } = await supabaseServer
        .from("bank_account")
        .update(upsertData)
        .eq("id", id)
        .select();

      if (error) throw error;
      bankAccount = data?.[0] as BankAccountRecord | undefined;
    } else {
      const { data, error } = await supabaseServer
        .from("bank_account")
        .insert([upsertData])
        .select();

      if (error) throw error;
      bankAccount = data?.[0] as BankAccountRecord | undefined;
    }

    if (bankAccount) {
      await appendBankAccountHistory({
        bankAccount,
        actionType: "UPDATED",
        requestId,
      });
    }

    logInfo("dashboard.bank_account.saved", {
      requestId,
      route,
      context: { id: bankAccount?.id ?? null },
    });
    return NextResponse.json(bankAccount || {});
  } catch (error) {
    logError("dashboard.bank_account.save.failed", {
      requestId,
      route,
      errorCode: "DASHBOARD_BANK_ACCOUNT_SAVE_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Failed to save bank account",
      code: "DASHBOARD_BANK_ACCOUNT_SAVE_FAILED",
      requestId,
    });
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = getRequestId(request);
  const route = "/api/dashboard/bank-account";

  if (!isAuthorized(request)) {
    return unauthorized(requestId);
  }

  const securityError = enforceWriteRequestSecurity(request, { requestId });
  if (securityError) return securityError;

  try {
    const body = await request.json().catch(() => null);
    const parsed = deleteBankAccountSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(400, {
        error: "入力内容が不正です",
        code: "VALIDATION_ERROR",
        fields: zodFields(parsed.error),
        requestId,
      });
    }

    const { data: existing, error: fetchError } = await supabaseServer
      .from("bank_account")
      .select("*")
      .eq("id", parsed.data.id)
      .maybeSingle();

    if (fetchError) throw fetchError;

    const { error } = await supabaseServer.from("bank_account").delete().eq("id", parsed.data.id);
    if (error) throw error;

    if (existing) {
      await appendBankAccountHistory({
        bankAccount: existing as BankAccountRecord,
        actionType: "DELETED",
        requestId,
      });
    }

    logInfo("dashboard.bank_account.deleted", {
      requestId,
      route,
      context: { id: parsed.data.id },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("dashboard.bank_account.delete.failed", {
      requestId,
      route,
      errorCode: "DASHBOARD_BANK_ACCOUNT_DELETE_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Failed to delete bank account",
      code: "DASHBOARD_BANK_ACCOUNT_DELETE_FAILED",
      requestId,
    });
  }
}

