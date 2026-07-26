// Deno Edge Function: publish a new current estimate catalog (desktop / ops).
// Requires secret CATALOG_PUBLISH_KEY (set via: supabase secrets set CATALOG_PUBLISH_KEY=...)
// Deploy: supabase functions deploy catalog-publish --no-verify-jwt
// Do NOT put the service role key in the browser — only this publish key.

import { cors, json, supabaseAdmin } from "../_shared/catalog_auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const expected = Deno.env.get("CATALOG_PUBLISH_KEY") ?? "";
    if (!expected) {
      return json({ ok: false, error: "publish_not_configured" }, 503);
    }

    const body = await req.json();
    const publish_key = String(body?.publish_key ?? "");
    if (publish_key !== expected) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const version_label = String(body?.version_label ?? "").trim();
    const ratebook = body?.ratebook;
    const kit_matrix = body?.kit_matrix;
    const kit_edits = body?.kit_edits ?? {};
    const notes = String(body?.notes ?? "");

    if (!version_label || !ratebook || !kit_matrix) {
      return json({ ok: false, error: "missing_fields" }, 400);
    }

    const supabase = supabaseAdmin();

    // Clear previous current flag, then insert new current row.
    const { error: clearErr } = await supabase
      .from("estimate_catalogs")
      .update({ is_current: false })
      .eq("is_current", true);

    if (clearErr) {
      return json({ ok: false, error: "server_error", detail: clearErr.message }, 500);
    }

    const { data, error } = await supabase
      .from("estimate_catalogs")
      .insert({
        version_label,
        is_current: true,
        ratebook,
        kit_matrix,
        kit_edits,
        notes,
      })
      .select("id, version_label, published_at")
      .single();

    if (error) {
      return json({ ok: false, error: "server_error", detail: error.message }, 500);
    }

    return json({
      ok: true,
      id: data.id,
      version_label: data.version_label,
      published_at: data.published_at,
    });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
