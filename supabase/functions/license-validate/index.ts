// Deno Edge Function: validate an already-activated device.
// Deploy: supabase functions deploy license-validate --no-verify-jwt

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const { device_id } = await req.json();
    if (!device_id) return json({ ok: false, error: "missing_fields" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

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
      .select("*")
      .eq("id", activation.license_id)
      .maybeSingle();

    if (!license) return json({ ok: false, error: "invalid_license" }, 404);
    if (license.status === "blocked") {
      return json({ ok: false, error: "blocked" }, 403);
    }

    const expiresAt = new Date(license.expires_at).getTime();
    if (expiresAt <= Date.now() || license.status === "expired") {
      await supabase.from("licenses").update({ status: "expired" }).eq("id", license.id);
      return json({ ok: false, error: "expired" }, 403);
    }

    await supabase
      .from("activations")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", activation.id);

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
