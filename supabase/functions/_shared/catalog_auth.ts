/** Shared helpers for catalog / license Edge Functions (survey schema). */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** Service-role client scoped to the `survey` schema (not SmartLineman public). */
export function supabaseAdmin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "survey" },
    },
  );
}

export type AuthedLicense = {
  activationId: string;
  license: Record<string, unknown>;
};

/** Resolve activated device → license. Returns Response on failure. */
export async function resolveActivatedDevice(
  supabase: SupabaseClient,
  device_id: unknown,
): Promise<AuthedLicense | Response> {
  if (!device_id) return json({ ok: false, error: "missing_fields" }, 400);

  const { data: activation } = await supabase
    .from("activations")
    .select("id, license_id")
    .eq("device_id", String(device_id))
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!activation) return json({ ok: false, error: "not_activated" }, 404);

  const { data: license } = await supabase
    .from("licenses")
    .select("*")
    .eq("id", activation.license_id)
    .maybeSingle();

  if (!license) return json({ ok: false, error: "invalid_license" }, 404);
  if (license.status === "blocked") {
    return json({ ok: false, error: "blocked" }, 403);
  }

  const expiresAt = new Date(license.expires_at as string).getTime();
  if (expiresAt <= Date.now() || license.status === "expired") {
    await supabase.from("licenses").update({ status: "expired" }).eq("id", license.id);
    return json({ ok: false, error: "expired" }, 403);
  }

  return { activationId: activation.id, license };
}

export function flag(license: Record<string, unknown>, key: string): boolean {
  return license[key] === true;
}
