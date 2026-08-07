// Deno Edge Function: publish survey rules and/or full estimate catalog.
// Deploy: supabase functions deploy catalog-publish --no-verify-jwt
// Secrets:
//   CATALOG_PUBLISH_KEY — full catalog (Mat/Lab + kits + rules); leave as-is if already set
//   SURVEY_RULES_PUBLISH_KEY — phone structure combinations only (rules mode)
//
// Modes:
// - rules (body.mode=rules or rules-only payload):
//     Push phone structure combinations. Auth: SURVEY_RULES_PUBLISH_KEY
//     (falls back to CATALOG_PUBLISH_KEY if rules key unset). Copies kits from current row.
// - full (body.mode=full or ratebook+kit_matrix provided):
//     Full catalog archive. Auth: CATALOG_PUBLISH_KEY only.

import { cors, json, supabaseAdmin } from "../_shared/catalog_auth.ts";

function rulesPublishAllowed(publish_key: string): boolean {
  const rulesKey = Deno.env.get("SURVEY_RULES_PUBLISH_KEY") || "";
  const catalogKey = Deno.env.get("CATALOG_PUBLISH_KEY") || "";
  if (rulesKey && publish_key === rulesKey) return true;
  // Fallback only when no dedicated rules key is configured yet.
  if (!rulesKey && catalogKey && publish_key === catalogKey) return true;
  return false;
}

function fullPublishAllowed(publish_key: string): boolean {
  const catalogKey = Deno.env.get("CATALOG_PUBLISH_KEY") || "";
  return !!(catalogKey && publish_key === catalogKey);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const body = await req.json();
    const publish_key = String(body?.publish_key || "");
    const version_label = String(body?.version_label || "").trim();
    const notes = String(body?.notes || "").trim();
    const survey_rules = body?.survey_rules ?? {};
    const modeRaw = String(body?.mode || "").toLowerCase().trim();

    if (!version_label) return json({ ok: false, error: "missing_version_label" }, 400);
    if (!survey_rules || typeof survey_rules !== "object" || Array.isArray(survey_rules)) {
      return json({ ok: false, error: "missing_survey_rules" }, 400);
    }

    const hasFullPayload =
      body?.ratebook &&
      typeof body.ratebook === "object" &&
      body?.kit_matrix &&
      typeof body.kit_matrix === "object";

    const rulesOnly =
      modeRaw === "rules" ||
      modeRaw === "survey_rules" ||
      (modeRaw !== "full" && !hasFullPayload);

    if (rulesOnly) {
      const rulesKey = Deno.env.get("SURVEY_RULES_PUBLISH_KEY") || "";
      const catalogKey = Deno.env.get("CATALOG_PUBLISH_KEY") || "";
      if (!rulesKey && !catalogKey) {
        return json({ ok: false, error: "publish_key_not_configured" }, 500);
      }
      if (!rulesPublishAllowed(publish_key)) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
    } else {
      if (!Deno.env.get("CATALOG_PUBLISH_KEY")) {
        return json({ ok: false, error: "publish_key_not_configured" }, 500);
      }
      if (!fullPublishAllowed(publish_key)) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
    }

    const supabase = supabaseAdmin();

    let ratebook = body?.ratebook;
    let kit_matrix = body?.kit_matrix;
    let kit_edits = body?.kit_edits ?? {};

    if (rulesOnly) {
      // Keep previous estimate archive so desk kits are not wiped by a rules-only push.
      const { data: current } = await supabase
        .from("estimate_catalogs")
        .select("ratebook, kit_matrix, kit_edits")
        .eq("is_current", true)
        .maybeSingle();

      ratebook = current?.ratebook ?? {};
      kit_matrix = current?.kit_matrix ?? {};
      kit_edits = current?.kit_edits ?? {};
    } else {
      if (!ratebook || typeof ratebook !== "object") {
        return json({ ok: false, error: "missing_ratebook" }, 400);
      }
      if (!kit_matrix || typeof kit_matrix !== "object") {
        return json({ ok: false, error: "missing_kit_matrix" }, 400);
      }
    }

    await supabase
      .from("estimate_catalogs")
      .update({ is_current: false })
      .eq("is_current", true);

    const row: Record<string, unknown> = {
      version_label,
      notes,
      ratebook,
      kit_matrix,
      kit_edits,
      survey_rules,
      is_current: true,
    };

    const { data, error } = await supabase
      .from("estimate_catalogs")
      .insert(row)
      .select("id, version_label, published_at")
      .maybeSingle();

    if (error) {
      return json({ ok: false, error: "server_error", detail: error.message }, 500);
    }

    return json({
      ok: true,
      id: data?.id,
      version_label: data?.version_label ?? version_label,
      published_at: data?.published_at,
      mode: rulesOnly ? "rules" : "full",
    });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
