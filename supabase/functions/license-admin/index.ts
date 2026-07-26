// Deno Edge Function: admin license management (can_approve only).
// Deploy: supabase functions deploy license-admin --no-verify-jwt
//
// Actions:
//   list   — list licenses + activation counts
//   create — create a new license code
//   update — patch status, expiry, devices, flags, customer fields

import {
  cors,
  flag,
  json,
  resolveActivatedDevice,
  supabaseAdmin,
} from "../_shared/catalog_auth.ts";

function normalizeCode(raw: string) {
  return String(raw || "").replace(/\s+/g, "").toUpperCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const body = await req.json();
    const action = String(body?.action || "list").toLowerCase();
    const supabase = supabaseAdmin();
    const auth = await resolveActivatedDevice(supabase, body?.device_id);
    if (auth instanceof Response) return auth;

    if (!flag(auth.license, "can_approve")) {
      return json({ ok: false, error: "not_allowed" }, 403);
    }

    if (action === "list") {
      const { data: licenses, error } = await supabase
        .from("licenses")
        .select(
          "id, code, customer_name, customer_phone, status, expires_at, max_devices, can_suggest, can_approve, notes, created_at, updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) {
        return json({ ok: false, error: "server_error", detail: error.message }, 500);
      }

      const { data: acts } = await supabase
        .from("activations")
        .select("license_id, device_id, device_label, activated_at, last_seen_at");

      const countByLic: Record<string, number> = {};
      const devicesByLic: Record<string, unknown[]> = {};
      for (const a of acts || []) {
        const id = a.license_id as string;
        countByLic[id] = (countByLic[id] || 0) + 1;
        if (!devicesByLic[id]) devicesByLic[id] = [];
        if (devicesByLic[id].length < 5) {
          devicesByLic[id].push({
            device_id: a.device_id,
            device_label: a.device_label,
            activated_at: a.activated_at,
            last_seen_at: a.last_seen_at,
          });
        }
      }

      const rows = (licenses || []).map((l) => ({
        ...l,
        activation_count: countByLic[l.id] || 0,
        devices: devicesByLic[l.id] || [],
      }));

      return json({ ok: true, licenses: rows });
    }

    if (action === "create") {
      const code = normalizeCode(body?.code || "");
      if (!code || code.length < 4) {
        return json({ ok: false, error: "invalid_code" }, 400);
      }
      const days = Math.max(1, Math.min(Number(body?.days) || 30, 730));
      const max_devices = Math.max(1, Math.min(Number(body?.max_devices) || 1, 5));
      const row = {
        code,
        customer_name: String(body?.customer_name || "").slice(0, 200),
        customer_phone: String(body?.customer_phone || "").slice(0, 40),
        status: "active",
        expires_at: new Date(Date.now() + days * 86400000).toISOString(),
        max_devices,
        can_suggest: body?.can_suggest === true,
        can_approve: body?.can_approve === true,
        notes: String(body?.notes || "").slice(0, 2000),
      };

      const { data, error } = await supabase
        .from("licenses")
        .insert(row)
        .select(
          "id, code, customer_name, customer_phone, status, expires_at, max_devices, can_suggest, can_approve, notes, created_at",
        )
        .single();

      if (error) {
        if (String(error.message || "").includes("duplicate") || error.code === "23505") {
          return json({ ok: false, error: "code_exists" }, 409);
        }
        return json({ ok: false, error: "server_error", detail: error.message }, 500);
      }
      return json({ ok: true, license: data });
    }

    if (action === "update") {
      const id = String(body?.id || "").trim();
      const code = normalizeCode(body?.code || "");
      if (!id && !code) return json({ ok: false, error: "missing_fields" }, 400);

      let q = supabase.from("licenses").select("id, code, can_approve").limit(1);
      q = id ? q.eq("id", id) : q.eq("code", code);
      const { data: existing, error: findErr } = await q.maybeSingle();
      if (findErr) {
        return json({ ok: false, error: "server_error", detail: findErr.message }, 500);
      }
      if (!existing) return json({ ok: false, error: "not_found" }, 404);

      // Don't let an admin strip their own approve flag (lock-out).
      if (
        existing.id === auth.license.id &&
        body?.can_approve === false
      ) {
        return json({ ok: false, error: "cannot_demote_self" }, 400);
      }
      if (
        existing.id === auth.license.id &&
        body?.status &&
        String(body.status) !== "active"
      ) {
        return json({ ok: false, error: "cannot_block_self" }, 400);
      }

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

      if (body?.customer_name != null) {
        patch.customer_name = String(body.customer_name).slice(0, 200);
      }
      if (body?.customer_phone != null) {
        patch.customer_phone = String(body.customer_phone).slice(0, 40);
      }
      if (body?.notes != null) {
        patch.notes = String(body.notes).slice(0, 2000);
      }
      if (body?.max_devices != null) {
        patch.max_devices = Math.max(1, Math.min(Number(body.max_devices) || 1, 5));
      }
      if (typeof body?.can_suggest === "boolean") patch.can_suggest = body.can_suggest;
      if (typeof body?.can_approve === "boolean") patch.can_approve = body.can_approve;
      if (body?.status && ["active", "blocked", "expired"].includes(String(body.status))) {
        patch.status = String(body.status);
      }

      const extendDays = Number(body?.extend_days);
      if (Number.isFinite(extendDays) && extendDays > 0) {
        const { data: full } = await supabase
          .from("licenses")
          .select("expires_at")
          .eq("id", existing.id)
          .single();
        const baseMs = Math.max(
          Date.now(),
          new Date(full?.expires_at || Date.now()).getTime(),
        );
        patch.expires_at = new Date(
          baseMs + Math.min(extendDays, 730) * 86400000,
        ).toISOString();
        patch.status = "active";
      }

      if (body?.set_days != null) {
        const days = Math.max(1, Math.min(Number(body.set_days) || 30, 730));
        patch.expires_at = new Date(Date.now() + days * 86400000).toISOString();
        patch.status = "active";
      }

      const { data: updated, error } = await supabase
        .from("licenses")
        .update(patch)
        .eq("id", existing.id)
        .select(
          "id, code, customer_name, customer_phone, status, expires_at, max_devices, can_suggest, can_approve, notes, updated_at",
        )
        .single();

      if (error) {
        return json({ ok: false, error: "server_error", detail: error.message }, 500);
      }
      return json({ ok: true, license: updated });
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
