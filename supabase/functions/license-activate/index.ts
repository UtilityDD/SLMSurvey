// Deno Edge Function: activate a rental license on this device.
// Deploy: supabase functions deploy license-activate --no-verify-jwt
// (App calls with anon key; function uses service role internally.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function normalizeCode(raw: string) {
  return raw.replace(/\s+/g, "").toUpperCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const { code, device_id, device_label } = await req.json();
    if (!code || !device_id) {
      return json({ ok: false, error: "missing_fields" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const normalized = normalizeCode(String(code));
    const { data: license, error: licErr } = await supabase
      .from("licenses")
      .select("*")
      .eq("code", normalized)
      .maybeSingle();

    if (licErr || !license) {
      return json({ ok: false, error: "invalid_code" }, 404);
    }
    if (license.status === "blocked") {
      return json({ ok: false, error: "blocked" }, 403);
    }

    const expiresAt = new Date(license.expires_at).getTime();
    if (expiresAt <= Date.now() || license.status === "expired") {
      await supabase.from("licenses").update({ status: "expired" }).eq("id", license.id);
      return json({ ok: false, error: "expired" }, 403);
    }

    const { data: existing } = await supabase
      .from("activations")
      .select("id")
      .eq("license_id", license.id)
      .eq("device_id", String(device_id))
      .maybeSingle();

    if (!existing) {
      const { count } = await supabase
        .from("activations")
        .select("*", { count: "exact", head: true })
        .eq("license_id", license.id);

      if ((count ?? 0) >= license.max_devices) {
        return json({ ok: false, error: "device_limit" }, 403);
      }

      const { error: actErr } = await supabase.from("activations").insert({
        license_id: license.id,
        device_id: String(device_id),
        device_label: String(device_label ?? ""),
      });
      if (actErr) return json({ ok: false, error: "activate_failed" }, 500);
    } else {
      await supabase
        .from("activations")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", existing.id);
    }

    return json({
      ok: true,
      code: license.code,
      customer_name: license.customer_name,
      expires_at: license.expires_at,
      max_devices: license.max_devices,
      grace_days: 7,
    });
  } catch (e) {
    return json({ ok: false, error: "server_error", detail: String(e) }, 500);
  }
});
