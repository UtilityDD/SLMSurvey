/**
 * App-specific sealed packages for survey maps (.slmmap) and preset packs (.slmpreset).
 * AES-256-GCM with a fixed app key — not org-specific. License stamp is inside ciphertext.
 *
 * File text format:
 *   #SLM/SEAL/1
 *   kind:map|preset
 *   iv:<base64>
 *   data:<base64>
 */
(function (global) {
  "use strict";

  var FORMAT_LINE = "#SLM/SEAL/1";
  var KIND_MAP = "map";
  var KIND_PRESET = "preset";
  var EXT_MAP = ".slmmap";
  var EXT_PRESET = ".slmpreset";

  // App-wide secret (same string used on Android SlmSeal). Not org-specific.
  var APP_SECRET =
    "SLM-ToolBox-Seal-v1|BlackGrapes|field-survey-transfer|do-not-edit-files";

  function b64FromBytes(buf) {
    var bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    var s = "";
    for (var i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function bytesFromB64(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  function utf8Bytes(str) {
    return new TextEncoder().encode(str);
  }

  function utf8String(bytes) {
    return new TextDecoder().decode(bytes);
  }

  async function deriveKey() {
    var hash = await crypto.subtle.digest("SHA-256", utf8Bytes(APP_SECRET));
    return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  }

  function licenseStamp() {
    var Lic = global.SlmLicense;
    var prefs = Lic && Lic.readPrefs ? Lic.readPrefs() : {};
    return {
      customerName: prefs.customerName || "",
      licenseCode: prefs.licenseCode || "",
      deviceId: Lic && Lic.deviceId ? Lic.deviceId() : "",
      platform: "web",
      canApprove: !!(Lic && Lic.canApprove && Lic.canApprove()),
      exportedAt: new Date().toISOString(),
    };
  }

  function isAdmin() {
    return !!(global.SlmLicense && global.SlmLicense.canApprove && global.SlmLicense.canApprove());
  }

  function looksSealed(text) {
    var t = String(text || "").trim();
    return t.indexOf("#SLM/SEAL/") === 0;
  }

  function parseEnvelope(text) {
    var lines = String(text || "")
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/);
    if (!lines.length || lines[0].trim() !== FORMAT_LINE) {
      throw new Error("Not an SLM sealed file");
    }
    var kind = "";
    var iv = "";
    var data = "";
    for (var i = 1; i < lines.length; i += 1) {
      var line = lines[i];
      if (!line || line.charAt(0) === "#") continue;
      var colon = line.indexOf(":");
      if (colon < 0) continue;
      var key = line.slice(0, colon).trim();
      var val = line.slice(colon + 1).trim();
      if (key === "kind") kind = val;
      else if (key === "iv") iv = val;
      else if (key === "data") data = val;
    }
    if (!kind || !iv || !data) throw new Error("Sealed file is incomplete");
    return { kind: kind, iv: iv, data: data };
  }

  async function seal(kind, payload) {
    if (kind !== KIND_MAP && kind !== KIND_PRESET) {
      throw new Error("Unknown seal kind");
    }
    var inner = {
      kind: kind,
      license: licenseStamp(),
      payload: payload,
    };
    var key = await deriveKey();
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      utf8Bytes(JSON.stringify(inner))
    );
    return (
      FORMAT_LINE +
      "\nkind:" +
      kind +
      "\niv:" +
      b64FromBytes(iv) +
      "\ndata:" +
      b64FromBytes(ct) +
      "\n"
    );
  }

  async function unseal(text, expectedKind) {
    var env = parseEnvelope(text);
    if (expectedKind && env.kind !== expectedKind) {
      throw new Error(
        "Wrong file type (got ." +
          (env.kind === KIND_PRESET ? "slmpreset" : "slmmap") +
          ")"
      );
    }
    var key = await deriveKey();
    var iv = bytesFromB64(env.iv);
    var ct = bytesFromB64(env.data);
    var plain;
    try {
      plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ct);
    } catch (err) {
      throw new Error("File is corrupt or was tampered with");
    }
    var inner = JSON.parse(utf8String(plain));
    if (!inner || typeof inner !== "object" || !inner.payload) {
      throw new Error("Sealed payload missing");
    }
    return {
      kind: inner.kind || env.kind,
      license: inner.license || {},
      payload: inner.payload,
    };
  }

  /**
   * Import helper: sealed always OK; plain JSON only for admin.
   * @returns {{ payload, license?, sealed: boolean }}
   */
  async function openTransferText(text, expectedKind) {
    var raw = String(text || "").trim();
    if (looksSealed(raw)) {
      var opened = await unseal(raw, expectedKind);
      return { payload: opened.payload, license: opened.license, sealed: true };
    }
    if (!isAdmin()) {
      throw new Error(
        "Plain JSON is admin-only. Use a sealed ." +
          (expectedKind === KIND_PRESET ? "slmpreset" : "slmmap") +
          " file."
      );
    }
    return { payload: JSON.parse(raw), license: null, sealed: false };
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || "application/octet-stream" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function exportMap(surveyObj, baseName) {
    var sealed = await seal(KIND_MAP, surveyObj);
    var name = (baseName || "workspace").replace(/\.(json|slmmap)$/i, "") + EXT_MAP;
    download(name, sealed, "application/octet-stream");
    return name;
  }

  async function exportPresetPack(packObj, baseName) {
    var sealed = await seal(KIND_PRESET, packObj);
    var name =
      (baseName || "presets").replace(/\.(json|slmpresets\.json|slmpreset)$/i, "") +
      EXT_PRESET;
    download(name, sealed, "application/octet-stream");
    return name;
  }

  async function exportMapPlain(surveyObj, baseName) {
    if (!isAdmin()) throw new Error("Plain JSON export requires admin license");
    var name = (baseName || "workspace").replace(/\.(json|slmmap)$/i, "") + ".json";
    download(name, JSON.stringify(surveyObj, null, 2), "application/json");
    return name;
  }

  async function exportPresetPlain(packObj, baseName) {
    if (!isAdmin()) throw new Error("Plain JSON export requires admin license");
    var name =
      (baseName || "presets").replace(/\.(json|slmpresets\.json|slmpreset)$/i, "") +
      ".json";
    download(name, JSON.stringify(packObj, null, 2), "application/json");
    return name;
  }

  global.SlmSeal = {
    KIND_MAP: KIND_MAP,
    KIND_PRESET: KIND_PRESET,
    EXT_MAP: EXT_MAP,
    EXT_PRESET: EXT_PRESET,
    isAdmin: isAdmin,
    looksSealed: looksSealed,
    seal: seal,
    unseal: unseal,
    openTransferText: openTransferText,
    exportMap: exportMap,
    exportPresetPack: exportPresetPack,
    exportMapPlain: exportMapPlain,
    exportPresetPlain: exportPresetPlain,
    licenseStamp: licenseStamp,
  };
})(window);
