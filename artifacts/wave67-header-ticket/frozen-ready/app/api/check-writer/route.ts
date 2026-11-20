import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  checkWriterContext,
  checkWriterState,
  UNLOCK_COOKIE,
} from "@/lib/check-writer-server";
import { encryptBank, unlockToken } from "@/lib/check-writer-crypto";
import {
  checkCents,
  checkDate,
  checkText,
  payrollCents,
  stubOptions,
  validRouting,
} from "@/lib/check-writer-rules";
import type {
  BankDetails,
  CheckSettings,
  CheckSnapshot,
} from "@/types/check-writer";
import { checkPdf } from "@/lib/check-writer-pdf";
import { readCheckBody } from "@/lib/check-writer-request";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export async function GET(req: Request) {
  try {
    return Response.json(
      await checkWriterState(
        new URL(req.url).searchParams.get("run") ?? undefined,
      ),
      { headers },
    );
  } catch {
    return Response.json(
      {
        error:
          "Check Writer could not load. Choose an active salon as Owner, or retry after setup.",
      },
      { status: 403, headers },
    );
  }
}
export async function POST(req: Request) {
  try {
    if (req.headers.get("origin") !== new URL(req.url).origin)
      return Response.json(
        { error: "Invalid request origin." },
        { status: 403, headers },
      );
    const body = await readCheckBody(req);
    const ctx = await checkWriterContext(
      ![
        "void",
        "lock",
        "unlock",
        "print_confirmed",
        "print_failed",
        "recover_creation",
        "cancel_creation",
      ].includes(body.action),
      body.action !== "unlock" && body.action !== "lock",
    );
    if (body.action !== "lock" && body.salonId !== ctx.salonId)
      throw Error(
        "Workspace changed. Reopen Check Writer for the selected salon.",
      );
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const r = await ctx.service.rpc(name, args);
      if (r.error) {
        const safeMessages = [
          "Creation request is canceled or changed. Recover its status before starting again.",
          "Request not found.",
          "Output is used or expired. Prepare a new output from History.",
          "Void checks cannot be printed.",
          "An active check already covers this employee and payroll period. Void it before replacement.",
          "Existing payroll check number conflicts. Review the next number.",
          "Check settings changed. Review again.",
          "Settings changed. Reload before saving.",
          "Check numbers cannot be reused, including void checks.",
          "Next check number cannot move backwards.",
          "Payroll changed. Review the latest locked payroll.",
          "Live payroll snapshot is invalid or expired.",
        ];
        if (r.error.code === "P0001" && safeMessages.includes(r.error.message))
          throw Error(r.error.message);
        throw Error(
          "Check Writer could not save. Reload to check payroll, settings and check numbers before retrying.",
        );
      }
      return r.data;
    };
    const scope = { p_salon: ctx.salonId, p_actor: ctx.user.id };
    if (
      ["recover_creation", "cancel_creation"].includes(body.action) &&
      uuid(body.requestId)
    ) {
      const result = await rpc("check_writer_recover_creation", {
        ...scope,
        p_request: body.requestId,
        p_cancel: body.action === "cancel_creation",
      });
      return Response.json(result, { headers });
    }
    if (
      body.action === "dispatch" &&
      uuid(body.outputId) &&
      ["print", "download"].includes(body.method)
    ) {
      await rpc("check_writer_dispatch_output", {
        ...scope,
        p_output: body.outputId,
        p_method: body.method,
      });
      return Response.json({ ok: true }, { headers });
    }
    if (body.action === "lock") {
      (await cookies()).delete(UNLOCK_COOKIE);
      return Response.json({ ok: true }, { headers });
    }
    if (body.action === "unlock") {
      const allowed = await ctx.service.rpc("check_writer_unlock_attempt", {
        p_actor: ctx.user.id,
      });
      if (allowed.error || allowed.data !== true)
        throw Error("Too many unlock attempts. Try again in 15 minutes.");
      const { data: current, error } = await ctx.client.auth.getUser();
      if (error || !current.user?.email)
        throw Error("Sign in again before unlocking.");
      const factors =
        current.user.factors?.filter((f) => f.status === "verified") ?? [];
      if (factors.length) {
        const factor = factors.find((f) => f.factor_type === "totp");
        if (!factor)
          throw Error("Use a verified authenticator to unlock Check Writer.");
        const challenge = await ctx.client.auth.mfa.challenge({
          factorId: factor.id,
        });
        if (challenge.error) throw Error("Verification failed.");
        const verified = await ctx.client.auth.mfa.verify({
          factorId: factor.id,
          challengeId: challenge.data.id,
          code: checkText(body.code, 6),
        });
        if (verified.error) throw Error("Verification failed.");
      } else {
        const password = body.password;
        if (
          typeof password !== "string" ||
          password.length < 1 ||
          password.length > 1024
        )
          throw Error("Verification failed.");
        const auth = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const verified = await auth.auth.signInWithPassword({
          email: current.user.email,
          password,
        });
        if (verified.error || verified.data.user?.id !== current.user.id)
          throw Error("Verification failed.");
        await auth.auth.signOut({ scope: "local" });
      }
      (await cookies()).set(UNLOCK_COOKIE, unlockToken(ctx.binding), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/check-writer",
        maxAge: 300,
      });
      return Response.json({ ok: true }, { headers });
    }
    if (body.action === "settings") {
      const input = body.settings;
      const issuer = checkText(input.issuer, 160),
        address = checkText(input.address, 500, true);
      if (!issuer || !address)
        throw Error("Enter the issuer name and address.");
      const config: CheckSettings = {
        issuer,
        address,
        useSalon: input.useSalon === true,
        bankName: "",
        last4: "",
        nextNumber: Number(input.nextNumber),
        version: Number(input.version),
        stock: input.stock === "blank" ? "blank" : "preprinted",
        offsetX: Number(input.offsetX),
        offsetY: Number(input.offsetY),
        stubs: stubOptions(input.stubs),
      };
      if (
        !Number.isSafeInteger(config.nextNumber) ||
        config.nextNumber < 1 ||
        config.nextNumber > 9999999999 ||
        ![config.offsetX, config.offsetY].every(
          (n) => Number.isFinite(n) && Math.abs(n) <= 12.7,
        )
      )
        throw Error("Invalid check number or alignment.");
      const current = await ctx.service
        .from("check_writer_settings")
        .select("bank_encrypted,public_config")
        .eq("salon_id", ctx.salonId)
        .maybeSingle();
      if (current.error) throw Error("Settings could not load.");
      let bankEncrypted = current.data?.bank_encrypted;
      if (body.bank) {
        const bank: BankDetails = {
          name: checkText(body.bank.name, 160),
          city: checkText(body.bank.city, 160),
          routing: checkText(body.bank.routing, 9),
          account: checkText(body.bank.account, 17),
          fractional: checkText(body.bank.fractional ?? "", 30),
        };
        if (
          !bank.name ||
          !validRouting(bank.routing) ||
          !/^\d{1,17}$/.test(bank.account)
        )
          throw Error(
            "Enter a bank name, valid 9-digit routing and account number.",
          );
        bankEncrypted = encryptBank(ctx.salonId, bank);
        config.bankName = bank.name;
        config.last4 = bank.account.slice(-4);
      } else {
        config.bankName = current.data?.public_config.bankName ?? "";
        config.last4 = current.data?.public_config.last4 ?? "";
      }
      if (!bankEncrypted) throw Error("Enter bank details before saving.");
      await rpc("check_writer_save_settings", {
        ...scope,
        p_bank: bankEncrypted,
        p_config: config,
        p_next: config.nextNumber,
        p_version: config.version,
      });
      return Response.json({ ok: true }, { headers });
    }
    if (body.action === "alignment") {
      const state = await checkWriterState(undefined, { payroll: false });
      const snapshot: CheckSnapshot = {
        payee: "SAMPLE — NOT A PAYMENT",
        amountCents: 12345,
        memo: "ALIGNMENT TEST — DO NOT CASH",
        date: "2026-01-01",
        issuer: "SAMPLE SALON",
        address: "100 Sample Ave\nSample City",
        bankEncrypted: "",
        stock: state.settings.stock,
        stubs: { same: true, payee: [], salon: [] },
      };
      const bytes = await checkPdf(
        [
          {
            id: "sample",
            number: 1001,
            snapshot,
            status: "issued",
            created_at: "",
            void_reason: null,
            delivery_count: 0,
          },
        ],
        ctx.salonId,
        true,
        { x: Number(body.x ?? 0), y: Number(body.y ?? 0) },
      );
      return new Response(new Uint8Array(bytes), {
        headers: { ...headers, "Content-Type": "application/pdf" },
      });
    }
    if (body.action === "issue" || body.action === "preview") {
      if (!uuid(body.requestId)) throw Error("Invalid request ID.");
      const requestHash = createHash("sha256")
        .update(JSON.stringify(body))
        .digest("hex");
      if (body.action === "issue") {
        const prior = await ctx.service
          .from("check_writer_batches")
          .select("salon_id,actor_id,request_hash")
          .eq("id", body.requestId)
          .maybeSingle();
        if (prior.error) throw Error("Check status could not be checked.");
        if (prior.data) {
          if (
            prior.data.salon_id !== ctx.salonId ||
            prior.data.actor_id !== ctx.user.id ||
            prior.data.request_hash !== requestHash
          )
            throw Error("Request already used with different contents.");
          const checks = await ctx.service
            .from("check_writer_checks")
            .select("id")
            .eq("salon_id", ctx.salonId)
            .eq("batch_id", body.requestId)
            .order("number");
          if (checks.error) throw Error("Check status could not be checked.");
          return Response.json(
            { ids: checks.data.map((c) => c.id) },
            { headers },
          );
        }
        await rpc("check_writer_reserve_creation", {
          ...scope,
          p_request: body.requestId,
          p_hash: requestHash,
        });
      }
      const state = await checkWriterState(body.runId, {
        payroll: body.mode === "payroll",
      });
      const s = state.settings;
      if (!s.version) throw Error("Save bank and check settings first.");
      if (body.settingsVersion !== s.version)
        throw Error("Check settings changed. Review again.");
      const date = checkDate(body.date),
        memo = checkText(body.memo, 250),
        stubs = stubOptions(body.stubs);
      const issuer = checkText(body.issuer ?? s.issuer, 160),
        address = checkText(body.address ?? s.address, 500, true);
      if (!issuer || !address)
        throw Error("Enter the issuer name and address.");
      const base = {
        date,
        memo,
        issuer,
        address,
        stubs,
        stock: s.stock,
        bankEncrypted: "",
      };
      const items: CheckSnapshot[] = [];
      if (body.mode === "payroll") {
        if (
          !state.selectedRun ||
          state.selectedRun.id !== body.runId ||
          state.selectedRun.version !== body.runVersion ||
          !Array.isArray(body.lines) ||
          body.lines.length < 1 ||
          body.lines.length > 100 ||
          new Set(body.lines.map((r: { id: string }) => r.id)).size !==
            body.lines.length
        )
          throw Error("Select the latest locked payroll.");
        for (const selected of body.lines) {
          const line = state.lines.find((l) => l.id === selected.id);
          if (
            !line ||
            line.updated_at !== selected.updatedAt ||
            line.final_check_amount !== selected.amount
          )
            throw Error("Payroll changed. Review again.");
          const payee = checkText(
            line.staff_legal_name_snapshot || selected.payee,
            160,
          );
          if (!payee) throw Error("Confirm the legal payee name.");
          items.push({
            ...base,
            payee,
            amountCents: payrollCents(line.final_check_amount),
            payroll: {
              check: payrollCents(line.final_check_amount),
              cash: Math.round(line.final_cash_amount * 100),
              tip: Math.round(line.tip_amount * 100),
              bonus: Math.round(line.bonus_amount * 100),
              gross: Math.round(line.gross_sales * 100),
              period: `${state.selectedRun.period_start} – ${state.selectedRun.period_end}`,
            },
            source: {
              kind: state.selectedRun.status === "live" ? "live" : "saved",
              calculatedAt: new Date().toISOString(),
              existingCheckNumber: line.check_number,
              lineId: line.id,
              runId: line.payroll_run_id,
              version: state.selectedRun.version,
              updatedAt: line.updated_at,
              staffId: line.staff_id,
              periodStart: state.selectedRun.period_start,
              periodEnd: state.selectedRun.period_end,
            },
          });
        }
      } else if (body.mode === "standalone") {
        const payee = checkText(body.payee, 160);
        if (!payee) throw Error("Enter the payee name.");
        items.push({
          ...base,
          stubs: { same: true, payee: [], salon: [] },
          payee,
          amountCents: checkCents(body.amount),
        });
      } else throw Error("Invalid check mode.");
      const stored = await ctx.service
        .from("check_writer_settings")
        .select("bank_encrypted")
        .eq("salon_id", ctx.salonId)
        .single();
      if (stored.error) throw Error("Check settings could not load.");
      // Validate the real immutable bank/issuer contents before consuming numbers.
      await checkPdf(
        items.map((snapshot, i) => ({
          id: "validation",
          number: s.nextNumber + i,
          snapshot: { ...snapshot, bankEncrypted: stored.data.bank_encrypted },
          status: "issued",
          created_at: "",
          void_reason: null,
          delivery_count: 0,
        })),
        ctx.salonId,
        false,
      );
      // Hash client intent, not mutable next-number/version, so a lost response
      // recovers the original batch even after another issuance advanced settings.
      const validationPdf = await checkPdf(
        items.map((snapshot, i) => ({
          id: "preview",
          number: s.nextNumber + i,
          snapshot: { ...snapshot, bankEncrypted: stored.data.bank_encrypted },
          status: "issued",
          created_at: "",
          void_reason: null,
          delivery_count: 0,
        })),
        ctx.salonId,
        true,
      );
      if (body.action === "preview")
        return new Response(new Uint8Array(validationPdf), {
          headers: { ...headers, "Content-Type": "application/pdf" },
        });
      const ids = await rpc("check_writer_issue", {
        ...scope,
        p_batch: body.requestId,
        p_hash: requestHash,
        p_version: body.settingsVersion,
        p_items: items,
      });
      return Response.json({ ids }, { headers });
    }
    if (
      ["void", "print_confirmed", "print_failed"].includes(body.action) &&
      uuid(body.id)
    ) {
      await rpc("check_writer_event", {
        ...scope,
        p_check: body.id,
        p_action: body.action,
        p_reason: checkText(body.reason ?? "", 500),
      });
      return Response.json({ ok: true }, { headers });
    }
    throw Error("Invalid Check Writer action.");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Check Writer could not complete this request.";
    return Response.json({ error: message }, { status: 400, headers });
  }
}
