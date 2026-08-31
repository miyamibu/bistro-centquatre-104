import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getStaffAuth } from "@/lib/staff-auth";
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

const BANK_ACCOUNT_SELECT =
  "id, bank_name, branch_name, account_type, account_number, account_holder";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const route = "/api/dashboard/bank-account";

  if (!(await getStaffAuth("ADMIN"))) {
    return unauthorized(requestId);
  }

  try {
    const { data, error } = await supabaseServer
      .from("bank_account")
      .select(BANK_ACCOUNT_SELECT)
      .limit(1);
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

  if (!(await getStaffAuth("ADMIN"))) {
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

    const encryptedAccountNumber = encryptBankHistoryValue(payload.account_number);
    const encryptedAccountHolder = encryptBankHistoryValue(payload.account_holder);
    const { data, error } = await supabaseServer.rpc("save_bank_account_with_history", {
      p_id: id ?? null,
      p_bank_name: upsertData.bank_name,
      p_branch_name: upsertData.branch_name,
      p_account_type: upsertData.account_type,
      p_account_number: upsertData.account_number,
      p_account_holder: upsertData.account_holder,
      p_account_number_enc: encryptedAccountNumber.ciphertext,
      p_account_holder_enc: encryptedAccountHolder.ciphertext,
      p_account_number_nonce: encryptedAccountNumber.nonce,
      p_account_number_auth_tag: encryptedAccountNumber.authTag,
      p_account_holder_nonce: encryptedAccountHolder.nonce,
      p_account_holder_auth_tag: encryptedAccountHolder.authTag,
      p_key_version: env.BANK_ACCOUNT_HISTORY_KEY_VERSION,
    });

    if (error) {
      throw error;
    }

    const bankAccount = data as BankAccountRecord | undefined;

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

  if (!(await getStaffAuth("ADMIN"))) {
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
      .select(BANK_ACCOUNT_SELECT)
      .eq("id", parsed.data.id)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (existing) {
      const bankAccount = existing as BankAccountRecord;
      const encryptedAccountNumber = encryptBankHistoryValue(bankAccount.account_number);
      const encryptedAccountHolder = encryptBankHistoryValue(bankAccount.account_holder);
      const { error } = await supabaseServer.rpc("delete_bank_account_with_history", {
        p_id: parsed.data.id,
        p_account_number_enc: encryptedAccountNumber.ciphertext,
        p_account_holder_enc: encryptedAccountHolder.ciphertext,
        p_account_number_nonce: encryptedAccountNumber.nonce,
        p_account_number_auth_tag: encryptedAccountNumber.authTag,
        p_account_holder_nonce: encryptedAccountHolder.nonce,
        p_account_holder_auth_tag: encryptedAccountHolder.authTag,
        p_key_version: env.BANK_ACCOUNT_HISTORY_KEY_VERSION,
      });

      if (error) throw error;
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
