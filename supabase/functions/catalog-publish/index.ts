// Deno Edge Function: publish estimate catalog (+ survey rules) with publish key.
// Deploy: supabase functions deploy catalog-publish --no-verify-jwt
// Secret: CATALOG_PUBLISH_KEY

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
    const ratebook = body?.ratebook;
    const kit_matrix = body?.kit_matrix;
    const kit_edits = body?.kit_edits ?? {};
    const survey_rules = body?.survey_rules ?? {};

    if (!version_label) return json({ ok: false, error: "missing_version_label" }, 400);
    if (!ratebook || typeof ratebook !== "object") {
      return json({ ok: false, error: "missing_ratebook" }, 400);
    }
    if (!kit_matrix || typeof kit_matrix !== "object") {
      return json({ ok: false, error: "missing_kit_matrix" }, 400);
    }

    const supabase = supabaseAdmin();

    // Clear current flag, then insert new current row.
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
    });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
