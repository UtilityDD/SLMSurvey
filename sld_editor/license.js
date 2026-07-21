/**
 * Rental license gate for the desktop CAD editor.
 * Uses the same Supabase Edge Functions as the Android app:
 *   POST /functions/v1/license-activate
 *   POST /functions/v1/license-validate
 *
 * One license code works on phone + desktop when max_devices >= 2.
 */
(function (global) {
  "use strict";

  var CFG = global.SLM_LICENSE_CONFIG || {};
  var URL_BASE = String(CFG.SUPABASE_URL || "").replace(/\/+$/, "");
  var ANON = String(CFG.SUPABASE_ANON_KEY || "");
  var ENABLED = URL_BASE.length > 0 && ANON.length > 0;

  var PREFS_KEY = "slm_license_prefs_v1";
  var DEVICE_KEY = "slm_web_device_id";
  var REVALIDATE_MS = 12 * 60 * 60 * 1000;
  var GRACE_DAYS_DEFAULT = 7;

  var resolveUnlock = null;

  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function deviceId() {
    try {
      var id = localStorage.getItem(DEVICE_KEY);
      if (id) return id;
      id = "slm-web-" + uuid();
      localStorage.setItem(DEVICE_KEY, id);
      return id;
    } catch (_) {
      return "slm-web-ephemeral";
    }
  }

  function deviceLabel() {
    var ua = navigator.userAgent || "";
    var browser = "Browser";
    if (/Edg\//.test(ua)) browser = "Edge";
    else if (/Chrome\//.test(ua)) browser = "Chrome";
    else if (/Firefox\//.test(ua)) browser = "Firefox";
    else if (/Safari\//.test(ua)) browser = "Safari";
    return "Desktop " + browser;
  }

  function readPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return defaultPrefs();
      return Object.assign(defaultPrefs(), JSON.parse(raw));
    } catch (_) {
      return defaultPrefs();
    }
  }

  function defaultPrefs() {
    return {
      activated: false,
      licenseCode: "",
      customerName: "",
      expiresAtEpochMs: 0,
      lastValidatedAtMs: 0,
      graceDays: GRACE_DAYS_DEFAULT,
      lastError: null,
    };
  }

  function writePrefs(p) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch (_) {}
  }

  function parseExpiresAt(iso) {
    if (!iso) return 0;
    var t = Date.parse(String(iso).trim().replace(" ", "T"));
    return Number.isFinite(t) ? t : 0;
  }

  function isTrial(prefs) {
    var code = String(prefs.licenseCode || "").toUpperCase();
    var name = String(prefs.customerName || "").toUpperCase();
    return code.indexOf("TRIAL") >= 0 || name.indexOf("TRIAL") >= 0;
  }

  function daysRemaining(prefs, now) {
    now = now || Date.now();
    var ms = prefs.expiresAtEpochMs - now;
    if (ms <= 0) return 0;
    return Math.ceil(ms / (24 * 60 * 60 * 1000));
  }

  function formatDate(ms) {
    try {
      return new Date(ms).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch (_) {
      return "—";
    }
  }

  /** @returns {'allowed'|'grace'|'locked'} */
  function evaluateAccess(prefs, now) {
    now = now || Date.now();
    if (!prefs.activated || prefs.expiresAtEpochMs <= 0) return "locked";
    if (now <= prefs.expiresAtEpochMs) return "allowed";
    var graceMs = (prefs.graceDays || GRACE_DAYS_DEFAULT) * 24 * 60 * 60 * 1000;
    var graceEnds =
      Math.max(prefs.expiresAtEpochMs, prefs.lastValidatedAtMs || 0) + graceMs;
    if (prefs.lastValidatedAtMs > 0 && now <= graceEnds) return "grace";
    return "locked";
  }

  function applyServerJson(json, fallbackCode) {
    if (!json || !json.ok) return false;
    var expiresMs = parseExpiresAt(json.expires_at);
    if (expiresMs <= 0) return false;
    var prefs = readPrefs();
    prefs.activated = true;
    prefs.customerName = json.customer_name || "";
    prefs.expiresAtEpochMs = expiresMs;
    prefs.lastValidatedAtMs = Date.now();
    prefs.graceDays = json.grace_days || GRACE_DAYS_DEFAULT;
    prefs.lastError = null;
    var code = (json.code || fallbackCode || "").toString().trim().toUpperCase();
    if (code) prefs.licenseCode = code;
    writePrefs(prefs);
    return true;
  }

  async function post(path, body) {
    var res = await fetch(URL_BASE + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + ANON,
        apikey: ANON,
      },
      body: JSON.stringify(body),
    });
    var text = await res.text();
    var json;
    try {
      json = JSON.parse(text || "{}");
    } catch (_) {
      json = { ok: false, error: "bad_response" };
    }
    if (res.status === 404 || json.code === "NOT_FOUND") {
      return { ok: false, error: "functions_missing" };
    }
    return json;
  }

  async function activate(code) {
    var json = await post("/functions/v1/license-activate", {
      code: String(code || "").trim(),
      device_id: deviceId(),
      device_label: deviceLabel(),
    });
    if (json.ok && applyServerJson(json, code)) {
      return { ok: true };
    }
    var err = json.error || "unknown";
    var prefs = readPrefs();
    prefs.lastError = err;
    writePrefs(prefs);
    return { ok: false, error: err };
  }

  async function validate() {
    var json = await post("/functions/v1/license-validate", {
      device_id: deviceId(),
    });
    if (json.ok && applyServerJson(json, readPrefs().licenseCode)) {
      return { ok: true };
    }
    var err = json.error || "unknown";
    var prefs = readPrefs();
    prefs.lastError = err;
    writePrefs(prefs);
    return { ok: false, error: err };
  }

  function errorMessage(code) {
    switch (code) {
      case "invalid_code":
        return "Invalid license code";
      case "expired":
        return "License expired — renew rental";
      case "blocked":
        return "License blocked — contact seller";
      case "device_limit":
        return "Device limit reached. Ask the seller to allow 2 devices (phone + desktop) for this code.";
      case "not_activated":
        return "Not activated on this computer";
      case "functions_missing":
        return "License server not set up — deploy Edge Functions";
      case "network":
        return "Network error — try again when online";
      default:
        return "Could not activate (" + (code || "unknown") + ")";
    }
  }

  function $(id) {
    return document.getElementById(id);
  }

  function setBusy(busy) {
    var btn = $("licenseActivateBtn");
    var input = $("licenseCodeInput");
    var prog = $("licenseProgress");
    if (btn) btn.disabled = busy;
    if (input) input.disabled = busy;
    if (prog) prog.classList.toggle("hidden", !busy);
  }

  function refreshStatus() {
    var el = $("licenseStatus");
    if (!el) return;
    var prefs = readPrefs();
    var access = evaluateAccess(prefs);
    if (access === "allowed") {
      var date = formatDate(prefs.expiresAtEpochMs);
      var days = daysRemaining(prefs);
      el.textContent = isTrial(prefs)
        ? "Trial · until " + date + " (" + days + " days left)"
        : "Active for " +
          (prefs.customerName || "—") +
          " · until " +
          date +
          " (" +
          days +
          " days left)";
    } else if (access === "grace") {
      el.textContent = "Offline grace — connect once to renew check";
    } else {
      el.textContent =
        "Locked: " + errorMessage(prefs.lastError || "not_activated");
    }
  }

  function showGate(show) {
    var gate = $("licenseGate");
    var app = $("appContainer");
    if (gate) gate.classList.toggle("hidden", !show);
    if (app) app.classList.toggle("license-locked", show);
  }

  function unlockEditor() {
    showGate(false);
    updateBadge();
    if (typeof resolveUnlock === "function") {
      var done = resolveUnlock;
      resolveUnlock = null;
      done(true);
    }
  }

  function updateBadge() {
    var badge = $("licenseBadge");
    if (!badge) return;
    if (!ENABLED) {
      badge.classList.add("hidden");
      return;
    }
    var prefs = readPrefs();
    var access = evaluateAccess(prefs);
    if (access !== "allowed" && access !== "grace") {
      badge.classList.add("hidden");
      return;
    }
    var date = formatDate(prefs.expiresAtEpochMs);
    var days = daysRemaining(prefs);
    badge.textContent = isTrial(prefs)
      ? "Trial · expires " + date + " · " + days + "d left"
      : "License · expires " + date + " · " + days + "d left";
    badge.classList.remove("hidden");
    badge.title = "Same rental key as the mobile app";
  }

  async function onActivateClick() {
    var input = $("licenseCodeInput");
    var code = input ? String(input.value || "").trim() : "";
    var errEl = $("licenseError");
    if (errEl) errEl.textContent = "";
    if (!code) {
      if (errEl) errEl.textContent = "Enter your license code";
      return;
    }
    setBusy(true);
    try {
      var result = await activate(code);
      if (result.ok) {
        refreshStatus();
        unlockEditor();
      } else {
        if (errEl) errEl.textContent = errorMessage(result.error);
        refreshStatus();
      }
    } catch (_) {
      if (errEl) errEl.textContent = errorMessage("network");
    } finally {
      setBusy(false);
    }
  }

  function wireUi() {
    var btn = $("licenseActivateBtn");
    var input = $("licenseCodeInput");
    if (btn) btn.addEventListener("click", onActivateClick);
    if (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") onActivateClick();
      });
    }
    var badge = $("licenseBadge");
    if (badge) {
      badge.addEventListener("click", function () {
        var prefs = readPrefs();
        var date = formatDate(prefs.expiresAtEpochMs);
        var days = daysRemaining(prefs);
        var msg = isTrial(prefs)
          ? "Trial license" +
            (prefs.licenseCode ? " (" + prefs.licenseCode + ")" : "") +
            "\nExpires: " +
            date +
            "\nDays left: " +
            days +
            "\n\nUse the same code on the phone app."
          : "Licensed to: " +
            (prefs.customerName || "—") +
            "\nExpires: " +
            date +
            "\nDays left: " +
            days;
        alert(msg);
      });
    }
  }

  /**
   * Call before starting the editor. Resolves true when licensed (or licensing off).
   */
  async function ensureLicensed() {
    wireUi();
    if (!ENABLED) {
      showGate(false);
      updateBadge();
      return true;
    }

    var prefs = readPrefs();
    var access = evaluateAccess(prefs);
    var now = Date.now();
    var needsNetwork =
      prefs.activated &&
      (now - (prefs.lastValidatedAtMs || 0) >= REVALIDATE_MS ||
        now > prefs.expiresAtEpochMs);

    if (needsNetwork) {
      try {
        await validate();
      } catch (_) {
        /* keep grace if previously allowed */
      }
      prefs = readPrefs();
      access = evaluateAccess(prefs);
    }

    if (access === "allowed" || access === "grace") {
      showGate(false);
      updateBadge();
      return true;
    }

    showGate(true);
    refreshStatus();
    return new Promise(function (resolve) {
      resolveUnlock = resolve;
    });
  }

  global.SlmLicense = {
    ensureLicensed: ensureLicensed,
    enabled: ENABLED,
    deviceId: deviceId,
  };
})(window);
