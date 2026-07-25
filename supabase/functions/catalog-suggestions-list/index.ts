// Deno Edge Function: list kit suggestions.
// Approvers see all (optional status filter); suggestors see their own only.
// Deploy: supabase functions deploy catalog-suggestions-list --no-verify-jwt

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
    const status = body?.status ? String(body.status) : "";
    const supabase = supabaseAdmin();
    const auth = await resolveActivatedDevice(supabase, device_id);
    if (auth instanceof Response) return auth;

    const canApprove = flag(auth.license, "can_approve");
    const canSuggest = flag(auth.license, "can_suggest");
    if (!canApprove && !canSuggest) {
      return json({ ok: false, error: "not_allowed" }, 403);
    }

    let q = supabase
      .from("estimate_suggestions")
      .select(
        "id, kit_id, kit_family, kit_label, base_version_label, proposed, message, status, submitter_code, submitter_device_id, review_note, reviewed_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (!canApprove) {
      q = q.eq("submitter_license_id", auth.license.id);
    }
    if (status && ["pending", "accepted", "rejected"].includes(status)) {
      q = q.eq("status", status);
    }

    const { data, error } = await q;
    if (error) {
      return json({ ok: false, error: "server_error", detail: error.message }, 500);
    }

    const pendingCount = canApprove
      ? (data || []).filter((s) => s.status === "pending").length
      : (data || []).filter((s) => s.status === "pending").length;

    // If filtered, still report total pending for badge when approver asks pending only.
    let badgePending = pendingCount;
    if (canApprove && status !== "pending") {
      const { count } = await supabase
        .from("estimate_suggestions")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
      badgePending = count ?? 0;
    }

    return json({
      ok: true,
      can_approve: canApprove,
      can_suggest: canSuggest,
      pending_count: badgePending,
      suggestions: data || [],
    });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
