/**
 * Phone survey rules — structure combinations for Map + phone wizard.
 * Publish to app from this page (survey-rules only; not kits/estimate).
 */
(function (global) {
  "use strict";

  var Desk = global.SlmDesk;
  var esc = function (s) {
    return Desk.escapeHtml(s);
  };

  var RULES_URL = "../estimate/survey-rules.json";
  var state = { rules: null, err: "", publishing: false };

  function loadRules(force) {
    if (state.rules && !force) return Promise.resolve(state.rules);
    return fetch(RULES_URL, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        state.rules = data;
        state.err = "";
        if (global.SlmNetworkCatalog && global.SlmNetworkCatalog.setRules) {
          global.SlmNetworkCatalog.setRules(data);
        }
        return data;
      });
  }

  function canPublish() {
    var L = global.SlmLicense;
    if (!L || !L.enabled) return true;
    return !!(L.canApprove && L.canApprove());
  }

  function matLabel(m) {
    if (typeof m === "string") return m;
    var id = m.id || m.label || "";
    var phone = m.phone !== false;
    return id + (phone ? "" : " (desk only)");
  }

  function voltageCard(v, block) {
    if (!block) return "";
    var mats = (block.materials || []).map(matLabel).join(", ") || "—";
    var phoneSt =
      (block.structuresPhone || block.structures || []).join(", ") || "—";
    var kitExtra = (block.kitStructuresExtra || []).join(", ");
    var cond = (block.conductors || []).join(", ") || "—";
    var dead = (block.deadEndStructures || []).join(", ") || "—";
    return (
      '<section class="dk-rules-card">' +
      "<h2>" +
      esc(v) +
      "</h2>" +
      "<dl>" +
      "<dt>Materials</dt><dd>" +
      esc(mats) +
      "</dd>" +
      "<dt>Phone structures</dt><dd>" +
      esc(phoneSt) +
      (kitExtra
        ? ' <span class="dk-rules-extra">+ kit-only: ' +
          esc(kitExtra) +
          "</span>"
        : "") +
      "</dd>" +
      "<dt>Conductors</dt><dd>" +
      esc(cond) +
      "</dd>" +
      "<dt>Dead-end structures</dt><dd>" +
      esc(dead) +
      "</dd>" +
      "</dl></section>"
    );
  }

  function resolvePublishKey() {
    var cfg = global.SLM_LICENSE_CONFIG || {};
    // Dedicated rules key — do not reuse / overwrite CATALOG_PUBLISH_KEY.
    var key = String(cfg.SURVEY_RULES_PUBLISH_KEY || "").trim();
    if (key) return Promise.resolve(key);
    try {
      key = String(sessionStorage.getItem("slm_survey_rules_publish_key") || "").trim();
    } catch (e) {
      key = "";
    }
    if (key) return Promise.resolve(key);
    var Dialog = global.SlmDialog;
    if (!Dialog || !Dialog.prompt) return Promise.resolve("");
    return Dialog.prompt({
      title: "Phone rules publish key",
      message:
        "Enter SURVEY_RULES_PUBLISH_KEY (Supabase secret). " +
        "This is separate from CATALOG_PUBLISH_KEY and does not change it.",
      inputLabel: "Rules publish key",
      inputType: "password",
      placeholder: "Secret key…",
      okLabel: "Continue",
    }).then(function (entered) {
      if (entered === null) return "";
      key = String(entered || "").trim();
      if (key) {
        try {
          sessionStorage.setItem("slm_survey_rules_publish_key", key);
        } catch (e) {
          /* ignore */
        }
      }
      return key;
    });
  }

  function publishRulesToApp(page) {
    if (state.publishing) return;
    var Dialog = global.SlmDialog;
    if (!canPublish()) {
      Desk.toast("Publish needs admin (can_approve) on your license");
      return;
    }
    var cfg = global.SLM_LICENSE_CONFIG || {};
    var base = String(cfg.SUPABASE_URL || "").replace(/\/$/, "");
    var anon = cfg.SUPABASE_ANON_KEY || "";
    if (!base || !anon) {
      if (Dialog && Dialog.alert) {
        Dialog.alert({
          title: "Missing config",
          message: "Supabase URL / anon key missing in license-config.js",
        });
      } else {
        Desk.toast("Missing Supabase config");
      }
      return;
    }

    var btn = page.querySelector("#dkPublishRules");
    var defaultLabel =
      "rules-" +
      (state.rules && state.rules.version != null
        ? "v" + state.rules.version + "-"
        : "") +
      new Date().toISOString().slice(0, 10);

    resolvePublishKey()
      .then(function (key) {
        if (!key) {
          Desk.toast("Publish cancelled");
          return null;
        }
        if (!Dialog || !Dialog.prompt) {
          Desk.toast("Dialogs unavailable");
          return null;
        }
        return Dialog.prompt({
          title: "Version label",
          message:
            "Label for this phone-rules publish. Phones use it to detect updates.",
          inputLabel: "Version",
          defaultValue: defaultLabel,
          okLabel: "Next",
        }).then(function (versionEntered) {
          if (versionEntered === null) return null;
          var version_label = String(versionEntered || "").trim();
          if (!version_label) return null;
          return Dialog.prompt({
            title: "Publish notes",
            message: "Optional notes (what changed in structure combinations).",
            inputLabel: "Notes",
            placeholder: "e.g. steel poles desk-only; 8m PCC no-ext…",
            okLabel: "Next",
          }).then(function (notesEntered) {
            if (notesEntered === null) return null;
            return Dialog.confirm({
              title: "Publish to app?",
              message:
                "Push phone structure combinations (“" +
                version_label +
                "”) to mobiles.\n" +
                "This updates survey rules only — not kits or rates.",
              okLabel: "Publish to app",
            }).then(function (go) {
              if (!go) return null;
              return { key: key, version_label: version_label, notes: String(notesEntered || "").trim() };
            });
          });
        });
      })
      .then(function (payload) {
        if (!payload) {
          if (payload === null) Desk.toast("Publish cancelled");
          return;
        }
        state.publishing = true;
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Publishing…";
        }
        Desk.toast("Publishing phone rules…");
        return loadRules(true).then(function (survey_rules) {
          return fetch(base + "/functions/v1/catalog-publish", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + anon,
              apikey: anon,
            },
            body: JSON.stringify({
              mode: "rules",
              publish_key: payload.key,
              version_label: payload.version_label,
              notes: payload.notes,
              survey_rules: survey_rules,
            }),
          }).then(function (res) {
            return res.json().catch(function () {
              return {};
            }).then(function (data) {
              if (!res.ok || !data.ok) {
                var msg = String(data.error || res.status);
                if (Dialog && Dialog.alert) {
                  return Dialog.alert({
                    title: "Publish failed",
                    message: msg,
                  });
                }
                Desk.toast("Publish failed: " + msg);
                return;
              }
              Desk.toast("Published " + (data.version_label || payload.version_label));
            });
          });
        });
      })
      .catch(function (err) {
        console.error(err);
        if (Dialog && Dialog.alert) {
          Dialog.alert({
            title: "Publish failed",
            message: "Network error while publishing phone rules.",
          });
        } else {
          Desk.toast("Publish failed");
        }
      })
      .then(function () {
        state.publishing = false;
        paint(page);
      });
  }

  function paint(page) {
    var r = state.rules;
    if (!r) {
      page.innerHTML =
        '<div class="dk-blank"><h2>No rules loaded</h2><p>' +
        esc(state.err || "Missing survey-rules.json") +
        "</p></div>";
      return;
    }
    var volts = r.voltages || Object.keys(r.byVoltage || {});
    var cards = volts
      .map(function (v) {
        return voltageCard(v, (r.byVoltage || {})[v]);
      })
      .join("");
    var admin = canPublish();

    page.innerHTML =
      '<div class="dk-page-pad">' +
      '<div class="dk-page-head"><h1>Phone rules</h1><p>' +
      esc(r.label || "survey-rules") +
      (r.version != null ? " · v" + esc(String(r.version)) : "") +
      " — structure combinations for Map chips and the phone wizard. " +
      "Kits / rates stay on Structures &amp; Estimate.</p></div>" +
      '<div class="dk-rules-actions">' +
      '<button type="button" class="dk-btn dk-btn-primary" id="dkPublishRules"' +
      (admin ? "" : " disabled title=\"Needs can_approve on your license\"") +
      ">" +
      (state.publishing ? "Publishing…" : "Publish to app") +
      "</button>" +
      '<button type="button" class="dk-btn" id="dkReloadRules">Reload</button>' +
      '<a class="dk-btn dk-btn-ghost" href="../estimate/survey-rules.json" target="_blank" rel="noopener">Raw JSON</a>' +
      "</div>" +
      (admin
        ? ""
        : '<p class="dk-rules-note">Sign in with an admin license (can_approve) to publish.</p>') +
      '<div class="dk-rules-grid">' +
      cards +
      "</div>" +
      '<p class="dk-rules-note">' +
      esc(
        r.notes ||
          "Edit estimate/survey-rules.json, then Publish to app so phones sync combinations."
      ) +
      "</p></div>";

    var pub = page.querySelector("#dkPublishRules");
    if (pub) {
      pub.addEventListener("click", function () {
        publishRulesToApp(page);
      });
    }
    var reload = page.querySelector("#dkReloadRules");
    if (reload) {
      reload.addEventListener("click", function () {
        page.innerHTML =
          '<div class="dk-blank"><h2>Loading phone rules…</h2></div>';
        loadRules(true)
          .then(function () {
            paint(page);
          })
          .catch(function (e) {
            state.err = String((e && e.message) || e);
            state.rules = null;
            paint(page);
          });
      });
    }
  }

  function render(host) {
    var page =
      host && host.classList && host.classList.contains("dk-page")
        ? host
        : (function () {
            var el = document.createElement("div");
            el.className = "dk-page";
            host.appendChild(el);
            return el;
          })();
    page.innerHTML = '<div class="dk-blank"><h2>Loading phone rules…</h2></div>';
    loadRules()
      .then(function () {
        paint(page);
      })
      .catch(function (e) {
        state.err = String((e && e.message) || e);
        paint(page);
      });
  }

  /** Mounted as Rates desk tab via rates.js */
  global.SlmDeskRules = {
    render: render,
    reload: function () {
      state.rules = null;
    },
  };
})(window);
