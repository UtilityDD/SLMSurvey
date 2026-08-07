// Deno Edge Function: publish survey rules and/or full estimate catalog.
// Deploy: supabase functions deploy catalog-publish --no-verify-jwt
// Secret: CATALOG_PUBLISH_KEY
//
// Modes:
// - rules (default when only survey_rules sent / body.mode=rules):
//     Push phone structure combinations. Copies ratebook/kits from current row if omitted.
// - full (body.mode=full or ratebook+kit_matrix provided):
//     Full catalog archive for desktop + rules for phones.

import { cors, json, supabaseAdmin } from "../_shared/catalog_auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const expected = Deno.env.get("CATALOG_PUBLISH_KEY") || "";
    if (!expected) {
      return json({ ok: false, error: "publish_key_not_configured" }, 500);
    }

    const body = await req.json();
    const publish_key = String(body?.publish_key || "");
    if (publish_key !== expected) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

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
