#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const value = item.slice(2);
    const equal = value.indexOf("=");
    if (equal >= 0) {
      args.set(value.slice(0, equal), value.slice(equal + 1));
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(value, "true");
      continue;
    }
    args.set(value, next);
    index += 1;
  }
  return args;
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function loadEnv(cwd) {
  return {
    ...readEnvFile(path.join(cwd, ".env")),
    ...readEnvFile(path.join(cwd, ".env.local")),
    ...process.env,
  };
}

function usage() {
  return [
    "使い方: node scripts/provision-staff.mjs --email staff@example.com --role STAFF",
    "既存のSupabase Authユーザーへ app_metadata.role を設定します。パスワードやMFA秘密値は扱いません。",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.has("password") || args.has("password-stdin")) {
    throw new Error("パスワードはこのスクリプトへ渡せません。Supabase公式画面でユーザーを作成してください");
  }

  const email = args.get("email")?.trim().toLowerCase();
  const role = args.get("role")?.trim().toUpperCase();
  if (!email || !email.includes("@") || !["ADMIN", "STAFF"].includes(role)) {
    throw new Error(usage());
  }

  const env = loadEnv(process.cwd());
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です");
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let page = 1;
  let matched = null;
  while (!matched) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`ユーザー一覧の取得に失敗しました: ${error.message}`);
    matched = data.users.find((user) => user.email?.trim().toLowerCase() === email) ?? null;
    if (matched || data.users.length < 1000) break;
    page += 1;
  }

  if (!matched) {
    throw new Error("指定メールアドレスのAuthユーザーが存在しません。先にSupabase公式画面で招待または作成してください");
  }

  const { data: updated, error } = await supabase.auth.admin.updateUserById(matched.id, {
    app_metadata: {
      ...(matched.app_metadata ?? {}),
      role,
    },
  });
  if (error) throw new Error(`スタッフ権限の更新に失敗しました: ${error.message}`);

  console.info(
    JSON.stringify(
      {
        ok: true,
        userId: updated.user?.id ?? matched.id,
        email,
        role,
        next: "対象ユーザー自身がTOTP MFAを登録し、管理画面で再認証してください",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`[staff:provision] 失敗: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
