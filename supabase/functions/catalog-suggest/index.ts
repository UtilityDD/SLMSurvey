// Deno Edge Function: submit a kit edit suggestion (can_suggest licenses only).
// Deploy: supabase functions deploy catalog-suggest --no-verify-jwt

import {
  cors,
  flag,
  json,
  resolveActivatedDevice,
  supabaseAdmin,
} from "../_shared/catalog_auth.ts";

const FAMILIES = new Set(["structure", "conductor", "addon"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const body = await req.json();
    const device_id = body?.device_id;
    const supabase = supabaseAdmin();
    const auth = await resolveActivatedDevice(supabase, device_id);
    if (auth instanceof Response) return auth;

    if (!flag(auth.license, "can_suggest")) {
      return json({ ok: false, error: "not_allowed" }, 403);
    }

    const kit_id = String(body?.kit_id ?? "").trim();
    const kit_family = String(body?.kit_family ?? "").trim();
    const proposed = body?.proposed;
    if (!kit_id || !FAMILIES.has(kit_family) || !proposed || typeof proposed !== "object") {
      return json({ ok: false, error: "missing_fields" }, 400);
    }

    const lines = Array.isArray(proposed.lines) ? proposed.lines : null;
    if (!lines) return json({ ok: false, error: "missing_fields" }, 400);

    const row = {
      kit_id,
      kit_family,
      kit_label: String(body?.kit_label ?? "").slice(0, 500),
      base_version_label: String(body?.base_version_label ?? "").slice(0, 200),
      proposed: {
        enabled: proposed.enabled !== false,
        complete: !!proposed.complete,
        lines,
        notes: String(proposed.notes ?? ""),
        // Kept for Structures Suggested matching across browsers/devices.
        poleToken: String(proposed.poleToken ?? proposed.pole_token ?? "").slice(0, 40),
        poleMaterial: String(proposed.poleMaterial ?? proposed.pole_material ?? "").slice(0, 80),
      },
      message: String(body?.message ?? "").slice(0, 2000),
      status: "pending",
      submitter_license_id: auth.license.id,
      submitter_device_id: String(device_id),
      submitter_code: String(auth.license.code ?? ""),
    };

    const { data, error } = await supabase
      .from("estimate_suggestions")
      .insert(row)
      .select("id, kit_id, status, created_at")
      .single();

    if (error) {
      return json({ ok: false, error: "server_error", detail: error.message }, 500);
    }

    await supabase
      .from("activations")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", auth.activationId);

    return json({ ok: true, suggestion: data });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
