/**
 * Desk — License management (admin / can_approve only).
 * Uses Supabase license-admin Edge Function.
 */
(function (global) {
  "use strict";

  var Desk = global.SlmDesk;
  var esc = function (s) {
    return Desk.escapeHtml(s);
  };

  var state = {
    licenses: [],
    q: "",
    status: "",
    editingId: null,
  };

  function canAdmin() {
    var L = global.SlmLicense;
    if (!L || !L.enabled) return true; // local/dev: UI available
    return !!(L.canApprove && L.canApprove());
  }

  function licensingOn() {
    var L = global.SlmLicense;
    return !!(L && L.enabled);
  }

  function formatExpiry(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (e) {
      return String(iso);
    }
  }

  function apiPost(body) {
    var L = global.SlmLicense;
    if (!L || !L.enabled) {
      return Promise.reject(new Error("licensing_disabled"));
    }
    return L.post("/functions/v1/license-admin", Object.assign({
      device_id: L.deviceId(),
    }, body || {}));
  }

  function filtered() {
    var q = String(state.q || "").trim().toLowerCase();
    var status = String(state.status || "").trim();
    return (state.licenses || []).filter(function (row) {
      if (status && String(row.status || "") !== status) return false;
      if (!q) return true;
      var hay =
        (row.code || "") +
        " " +
        (row.customer_name || "") +
        " " +
        (row.customer_phone || "");
      return hay.toLowerCase().indexOf(q) !== -1;
    });
  }

  function closeModal() {
    var root = document.getElementById("dkLicModal");
    if (root) root.classList.add("hidden");
    state.editingId = null;
  }

  function openModal(id) {
    var row = id
      ? (state.licenses || []).find(function (x) {
          return x.id === id;
        })
      : null;
    state.editingId = row ? row.id : null;
    var root = document.getElementById("dkLicModal");
    if (!root) {
      root = document.createElement("div");
      root.id = "dkLicModal";
      root.className = "dk-modal-root hidden";
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-modal", "true");
      document.body.appendChild(root);
      root.addEventListener("click", function (e) {
        if (e.target === root) closeModal();
      });
    }
    root.innerHTML =
      '<div class="dk-modal-card dk-lic-modal-card">' +
      '<div class="dk-modal-head"><h2>' +
      (row ? "Edit license" : "New license") +
      '</h2><button type="button" class="dk-icon-btn" id="dkLicModalClose" title="Close">×</button></div>' +
      '<div class="dk-modal-body">' +
      '<p class="dk-modal-sub">' +
      (row
        ? "Update customer, devices, flags, or reset expiry from today."
        : "Create a rental code for a customer.") +
      "</p>" +
      '<label class="dk-lic-label">License code</label>' +
      '<input type="text" class="dk-input" id="dkLicCode" autocomplete="off" spellcheck="false" ' +
      (row ? "disabled " : "") +
      'placeholder="SLM-CUSTOMER-001" value="' +
      esc(row ? row.code || "" : "") +
      '">' +
      '<label class="dk-lic-label">Customer name</label>' +
      '<input type="text" class="dk-input" id="dkLicCustomer" value="' +
      esc(row ? row.customer_name || "" : "") +
      '" placeholder="Name">' +
      '<label class="dk-lic-label">Phone</label>' +
      '<input type="text" class="dk-input" id="dkLicPhone" value="' +
      esc(row ? row.customer_phone || "" : "") +
      '" placeholder="Optional">' +
      '<label class="dk-lic-label">Days from today' +
      (row ? " (blank = keep expiry)" : "") +
      "</label>" +
      '<input type="number" class="dk-input" id="dkLicDays" min="1" max="730" value="' +
      (row ? "" : "30") +
      '" placeholder="' +
      (row ? "Keep current" : "30") +
      '">' +
      '<label class="dk-lic-label">Max devices (1–5)</label>' +
      '<input type="number" class="dk-input" id="dkLicMax" min="1" max="5" value="' +
      esc(String(row ? row.max_devices || 1 : 1)) +
      '">' +
      '<label class="dk-lic-check"><input type="checkbox" id="dkLicSuggest"' +
      (row && row.can_suggest ? " checked" : "") +
      "> can_suggest</label>" +
      '<label class="dk-lic-check"><input type="checkbox" id="dkLicApprove"' +
      (row && row.can_approve ? " checked" : "") +
      "> can_approve (admin)</label>" +
      '<label class="dk-lic-label">Notes</label>' +
      '<textarea class="dk-input dk-lic-notes" id="dkLicNotes" placeholder="Optional">' +
      esc(row ? row.notes || "" : "") +
      "</textarea>" +
      '<div class="dk-modal-actions">' +
      '<button type="button" class="dk-btn" id="dkLicModalCancel">Cancel</button>' +
      '<button type="button" class="dk-btn dk-btn-primary" id="dkLicModalSave">Save</button>' +
      "</div></div></div>";
    root.classList.remove("hidden");
    root.querySelector("#dkLicModalClose").addEventListener("click", closeModal);
    root.querySelector("#dkLicModalCancel").addEventListener("click", closeModal);
    root.querySelector("#dkLicModalSave").addEventListener("click", saveModal);
  }

  function saveModal() {
    var id = state.editingId;
    var code = String(
      (document.getElementById("dkLicCode") || {}).value || ""
    )
      .replace(/\s+/g, "")
      .toUpperCase();
    var daysRaw = String((document.getElementById("dkLicDays") || {}).value || "").trim();
    var days =
      daysRaw === ""
        ? null
        : Math.max(1, Math.min(Number(daysRaw) || 30, 730));
    var maxDevices = Math.max(
      1,
      Math.min(Number((document.getElementById("dkLicMax") || {}).value) || 1, 5)
    );
    var payload = {
      customer_name: String(
        (document.getElementById("dkLicCustomer") || {}).value || ""
      ).trim(),
      customer_phone: String(
        (document.getElementById("dkLicPhone") || {}).value || ""
      ).trim(),
      max_devices: maxDevices,
      can_suggest: !!(document.getElementById("dkLicSuggest") || {}).checked,
      can_approve: !!(document.getElementById("dkLicApprove") || {}).checked,
      notes: String((document.getElementById("dkLicNotes") || {}).value || "").trim(),
    };
    var btn = document.getElementById("dkLicModalSave");
    if (btn) btn.disabled = true;

    var req;
    if (id) {
      var body = Object.assign({ action: "update", id: id }, payload);
      if (days != null) body.set_days = days;
      req = apiPost(body);
    } else {
      if (!code || code.length < 4) {
        Desk.toast("Enter a license code (min 4 chars)");
        if (btn) btn.disabled = false;
        return;
      }
      req = apiPost(
        Object.assign(
          {
            action: "create",
            code: code,
            days: days != null ? days : 30,
          },
          payload
        )
      );
    }

    req
      .then(function (json) {
        if (!json || !json.ok) {
          Desk.toast("Save failed: " + ((json && json.error) || "unknown"));
          return;
        }
        Desk.toast(id ? "License updated" : "License created");
        closeModal();
        return loadLicenses().then(paintActive);
      })
      .catch(function () {
        Desk.toast("Save failed (network)");
      })
      .then(function () {
        if (btn) btn.disabled = false;
      });
  }

  function extendLicense(id, days) {
    var row = (state.licenses || []).find(function (x) {
      return x.id === id;
    });
    if (!row) return;
    var Dialog = global.SlmDialog;
    var go = Dialog && Dialog.confirm
      ? Dialog.confirm({
          title: "Extend license",
          message: "Add " + days + " days to " + row.code + "?",
          okLabel: "Extend",
        })
      : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) return;
      return apiPost({ action: "update", id: id, extend_days: days }).then(
        function (json) {
          if (!json || !json.ok) {
            Desk.toast("Extend failed: " + ((json && json.error) || "unknown"));
            return;
          }
          Desk.toast("Extended +" + days + " days");
          return loadLicenses().then(paintActive);
        }
      );
    }).catch(function () {
      Desk.toast("Extend failed (network)");
    });
  }

  function setStatus(id, status) {
    var row = (state.licenses || []).find(function (x) {
      return x.id === id;
    });
    if (!row) return;
    var Dialog = global.SlmDialog;
    var go = Dialog && Dialog.confirm
      ? Dialog.confirm({
          title: status === "blocked" ? "Block license" : "Unblock license",
          message:
            status === "blocked"
              ? "Block " + row.code + "? Devices will stop validating."
              : "Set " + row.code + " back to active?",
          okLabel: status === "blocked" ? "Block" : "Unblock",
        })
      : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) return;
      return apiPost({ action: "update", id: id, status: status }).then(
        function (json) {
          if (!json || !json.ok) {
            Desk.toast("Update failed: " + ((json && json.error) || "unknown"));
            return;
          }
          Desk.toast(status === "blocked" ? "Blocked" : "Unblocked");
          return loadLicenses().then(paintActive);
        }
      );
    }).catch(function () {
      Desk.toast("Update failed (network)");
    });
  }

  function loadLicenses() {
    if (!canAdmin()) {
      state.licenses = [];
      return Promise.resolve();
    }
    if (!licensingOn()) {
      state.licenses = [];
      return Promise.resolve({ offline: true });
    }
    return apiPost({ action: "list" })
      .then(function (json) {
        if (
          json &&
          !json.ok &&
          (json.error === "not_activated" || json.error === "not_allowed")
        ) {
          var code = (
            (global.SlmLicense.readPrefs &&
              global.SlmLicense.readPrefs().licenseCode) ||
            ""
          ).trim();
          if (code && global.SlmLicense.activate) {
            return global.SlmLicense.activate(code).then(function (again) {
              if (again && again.ok) {
                return apiPost({ action: "list" });
              }
              return json;
            });
          }
        }
        return json;
      })
      .then(function (json) {
        if (!json || !json.ok) {
          var err = (json && json.error) || "unknown";
          Desk.toast("Licenses failed: " + err);
          state.licenses = [];
          state._loadError = err;
          return;
        }
        state.licenses = json.licenses || [];
        state._loadError = "";
      })
      .catch(function () {
        state.licenses = [];
        state._loadError = "network";
        Desk.toast("Licenses failed (network)");
      });
  }

  var paintHost = null;

  function paintActive() {
    if (paintHost) paint(paintHost);
  }

  function tableHtml() {
    var rows = filtered();
    if (!rows.length) {
      return (
        '<div class="dk-blank-inline">' +
        ((state.licenses || []).length
          ? "No licenses match this filter."
          : "No licenses yet.") +
        "</div>"
      );
    }
    return (
      '<div class="dk-lic-table-wrap"><table class="dk-lic-table"><thead><tr>' +
      "<th>Code</th><th>Customer</th><th>Status</th><th>Expires</th>" +
      "<th>Devices</th><th>Flags</th><th></th>" +
      "</tr></thead><tbody>" +
      rows
        .map(function (r) {
          var flags = [
            r.can_suggest ? "suggest" : null,
            r.can_approve ? "approve" : null,
          ]
            .filter(Boolean)
            .join(" · ") || "—";
          var st = String(r.status || "");
          return (
            "<tr>" +
            "<td><code>" +
            esc(r.code || "") +
            "</code></td>" +
            "<td><div>" +
            esc(r.customer_name || "—") +
            '</div><div class="dk-lic-muted">' +
            esc(r.customer_phone || "") +
            "</div></td>" +
            '<td><span class="dk-lic-chip is-' +
            esc(st) +
            '">' +
            esc(st) +
            "</span></td>" +
            "<td>" +
            esc(formatExpiry(r.expires_at)) +
            "</td>" +
            "<td>" +
            (Number(r.activation_count) || 0) +
            " / " +
            (Number(r.max_devices) || 1) +
            "</td>" +
            '<td class="dk-lic-muted">' +
            esc(flags) +
            "</td>" +
            '<td class="dk-lic-actions">' +
            '<button type="button" class="dk-btn dk-btn-sm" data-lic-edit="' +
            esc(r.id) +
            '">Edit</button>' +
            '<button type="button" class="dk-btn dk-btn-sm" data-lic-extend="' +
            esc(r.id) +
            '">+30d</button>' +
            (st === "blocked"
              ? '<button type="button" class="dk-btn dk-btn-sm" data-lic-unblock="' +
                esc(r.id) +
                '">Unblock</button>'
              : '<button type="button" class="dk-btn dk-btn-sm" data-lic-block="' +
                esc(r.id) +
                '">Block</button>') +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>"
    );
  }

  function paint(page) {
    paintHost = page;
    if (!canAdmin()) {
      page.innerHTML =
        '<div class="dk-page-pad"><div class="dk-blank">' +
        "<h2>Admin only</h2>" +
        "<p>License management needs <code>can_approve</code> on your activated license.</p>" +
        "</div></div>";
      return;
    }

    var offline = !licensingOn();
    page.innerHTML =
      '<div class="dk-page-pad">' +
      '<div class="dk-page-head"><h1>Licenses</h1>' +
      "<p>Create, extend, and block rental codes. Server checks <code>can_approve</code>.</p></div>" +
      (offline
        ? '<p class="dk-rules-note">Licensing is off in this build — activate an admin license to manage codes online.</p>'
        : "") +
      (state._loadError
        ? '<p class="dk-rules-note">Could not load: ' +
          esc(state._loadError) +
          "</p>"
        : "") +
      '<div class="dk-lic-toolbar">' +
      '<input type="search" class="dk-input dk-lic-search" id="dkLicSearch" placeholder="Filter by code or customer…" value="' +
      esc(state.q) +
      '">' +
      '<select class="dk-input dk-lic-filter" id="dkLicStatus">' +
      '<option value="">All statuses</option>' +
      '<option value="active"' +
      (state.status === "active" ? " selected" : "") +
      ">Active</option>" +
      '<option value="blocked"' +
      (state.status === "blocked" ? " selected" : "") +
      ">Blocked</option>" +
      '<option value="expired"' +
      (state.status === "expired" ? " selected" : "") +
      ">Expired</option>" +
      "</select>" +
      '<button type="button" class="dk-btn" id="dkLicRefresh">Refresh</button>' +
      '<button type="button" class="dk-btn dk-btn-primary" id="dkLicNew"' +
      (offline ? " disabled" : "") +
      ">+ New license</button>" +
      "</div>" +
      tableHtml() +
      "</div>";

    var search = page.querySelector("#dkLicSearch");
    if (search) {
      search.addEventListener("input", function () {
        state.q = search.value;
        paint(page);
        var again = page.querySelector("#dkLicSearch");
        if (again) {
          again.focus();
          var len = again.value.length;
          again.setSelectionRange(len, len);
        }
      });
    }
    var statusEl = page.querySelector("#dkLicStatus");
    if (statusEl) {
      statusEl.addEventListener("change", function () {
        state.status = statusEl.value;
        paint(page);
      });
    }
    var refresh = page.querySelector("#dkLicRefresh");
    if (refresh) {
      refresh.addEventListener("click", function () {
        loadLicenses().then(function () {
          paint(page);
        });
      });
    }
    var neu = page.querySelector("#dkLicNew");
    if (neu) {
      neu.addEventListener("click", function () {
        openModal(null);
      });
    }
    page.querySelectorAll("[data-lic-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openModal(btn.getAttribute("data-lic-edit"));
      });
    });
    page.querySelectorAll("[data-lic-extend]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        extendLicense(btn.getAttribute("data-lic-extend"), 30);
      });
    });
    page.querySelectorAll("[data-lic-block]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setStatus(btn.getAttribute("data-lic-block"), "blocked");
      });
    });
    page.querySelectorAll("[data-lic-unblock]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setStatus(btn.getAttribute("data-lic-unblock"), "active");
      });
    });
  }

  function render(host) {
    var page = document.createElement("div");
    page.className = "dk-page";
    host.appendChild(page);
    page.innerHTML =
      '<div class="dk-blank"><h2>Loading licenses…</h2></div>';
    if (!canAdmin()) {
      paint(page);
      return;
    }
    loadLicenses().then(function () {
      paint(page);
    });
  }

  Desk.register("licenses", {
    tools: function () {
      return [
        {
          label: "Refresh",
          onClick: function () {
            Desk.refresh();
          },
        },
        {
          label: "+ New license",
          kind: "primary",
          onClick: function () {
            if (!canAdmin()) {
              Desk.toast("Admin license required");
              return;
            }
            openModal(null);
          },
        },
      ];
    },
    render: render,
  });

  global.SlmDeskLicenses = {
    canAdmin: canAdmin,
  };
})(window);
