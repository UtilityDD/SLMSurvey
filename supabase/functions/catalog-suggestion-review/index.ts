// Deno Edge Function: accept or reject a kit suggestion (can_approve only).
// Accept returns proposed payload for Assembly Builder merge — does not auto-publish.
// Deploy: supabase functions deploy catalog-suggestion-review --no-verify-jwt

import {
  cors,
  flag,
  json,
  resolveActivatedDevice,
  supabaseAdmin,
} from "../_shared/catalog_auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const body = await req.json();
    const device_id = body?.device_id;
    const suggestion_id = String(body?.suggestion_id ?? "").trim();
    const action = String(body?.action ?? "").trim().toLowerCase();
    const review_note = String(body?.review_note ?? "").slice(0, 2000);

    if (!suggestion_id || (action !== "accept" && action !== "reject")) {
      return json({ ok: false, error: "missing_fields" }, 400);
    }

    const supabase = supabaseAdmin();
    const auth = await resolveActivatedDevice(supabase, device_id);
    if (auth instanceof Response) return auth;

    if (!flag(auth.license, "can_approve")) {
      return json({ ok: false, error: "not_allowed" }, 403);
    }

    const { data: existing, error: fetchErr } = await supabase
      .from("estimate_suggestions")
      .select("*")
      .eq("id", suggestion_id)
      .maybeSingle();

    if (fetchErr) {
      return json({ ok: false, error: "server_error", detail: fetchErr.message }, 500);
    }
    if (!existing) return json({ ok: false, error: "not_found" }, 404);
    if (existing.status !== "pending") {
      return json({ ok: false, error: "already_reviewed" }, 409);
    }

    const status = action === "accept" ? "accepted" : "rejected";
    const { data: updated, error } = await supabase
      .from("estimate_suggestions")
      .update({
        status,
        reviewer_license_id: auth.license.id,
        reviewer_device_id: String(device_id),
        review_note,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", suggestion_id)
      .eq("status", "pending")
      .select("id, kit_id, kit_family, kit_label, proposed, status, reviewed_at")
      .maybeSingle();

    if (error) {
      return json({ ok: false, error: "server_error", detail: error.message }, 500);
    }
    if (!updated) {
      return json({ ok: false, error: "already_reviewed" }, 409);
    }

    await supabase
      .from("activations")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", auth.activationId);

    return json({
      ok: true,
      action,
      suggestion: updated,
      kit_id: updated.kit_id,
      proposed: updated.proposed,
    });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
