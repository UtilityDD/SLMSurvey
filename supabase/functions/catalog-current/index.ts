// Deno Edge Function: return current estimate catalog to an activated device.
// Deploy: supabase functions deploy catalog-current --no-verify-jwt

import { cors, json, supabaseAdmin } from "../_shared/catalog_auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const body = await req.json();
    const device_id = body?.device_id;
    const known_version = body?.version_label ? String(body.version_label) : "";
    // "rules" = phone survey combinations only (no heavy kit_matrix/ratebook)
    // "full" / omitted = desktop-style full catalog
    const need = String(body?.need || body?.mode || "full").toLowerCase();
    const rulesOnly = need === "rules" || need === "survey_rules";

    if (!device_id) return json({ ok: false, error: "missing_fields" }, 400);

    const supabase = supabaseAdmin();

    const { data: activation } = await supabase
      .from("activations")
      .select("id, license_id")
      .eq("device_id", String(device_id))
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!activation) {
      return json({ ok: false, error: "not_activated" }, 404);
    }

    const { data: license } = await supabase
      .from("licenses")
      .select("id, status, expires_at")
      .eq("id", activation.license_id)
      .maybeSingle();

    if (!license) return json({ ok: false, error: "invalid_license" }, 404);
    if (license.status === "blocked") {
      return json({ ok: false, error: "blocked" }, 403);
    }

    const expiresAt = new Date(license.expires_at).getTime();
    if (expiresAt <= Date.now() || license.status === "expired") {
      return json({ ok: false, error: "expired" }, 403);
    }

    const selectCols = rulesOnly
      ? "id, version_label, published_at, notes, survey_rules"
      : "id, version_label, published_at, notes, ratebook, kit_matrix, kit_edits, survey_rules";

    const { data: catalog, error } = await supabase
      .from("estimate_catalogs")
      .select(selectCols)
      .eq("is_current", true)
      .maybeSingle();

    if (error) {
      return json({ ok: false, error: "server_error", detail: error.message }, 500);
    }
    if (!catalog) {
      return json({ ok: false, error: "no_catalog" }, 404);
    }

    if (known_version && known_version === catalog.version_label) {
      return json({
        ok: true,
        unchanged: true,
        version_label: catalog.version_label,
        published_at: catalog.published_at,
        notes: catalog.notes ?? "",
      });
    }

    if (rulesOnly) {
      return json({
        ok: true,
        unchanged: false,
        id: catalog.id,
        version_label: catalog.version_label,
        published_at: catalog.published_at,
        notes: catalog.notes ?? "",
        survey_rules: catalog.survey_rules ?? {},
      });
    }

    return json({
      ok: true,
      unchanged: false,
      id: catalog.id,
      version_label: catalog.version_label,
      published_at: catalog.published_at,
      notes: catalog.notes ?? "",
      ratebook: catalog.ratebook,
      kit_matrix: catalog.kit_matrix,
      kit_edits: catalog.kit_edits ?? {},
      survey_rules: catalog.survey_rules ?? {},
    });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
