/**
 * Structure library — visual catalog desk.
 * Loads estimate/kit-matrix.json, groups by voltage → type, status for review.
 */
(function () {
  "use strict";

  var MATRIX_URL = "../estimate/kit-matrix.json";
  var SCHEDULE_URL = "../estimate/demo_contract_schedule.json";
  var REVIEW_KEY = "slm_structure_review_v1";

  var VOLTAGES = ["33kV", "11kV", "LT"];
  var STATUS_FILTERS = [
    { id: "all", label: "All" },
    { id: "final", label: "Final" },
    { id: "suggested", label: "Suggested" },
    { id: "draft", label: "Draft" },
    { id: "empty", label: "Empty" },
    { id: "linked", label: "Schedule linked" },
  ];

  var state = {
    matrix: null,
    scheduleByCode: Object.create(null),
    voltage: "11kV",
    status: "all",
    q: "",
    selectedId: null,
    reviews: loadReviews(),
    mode: "browse",
    editLoaded: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadReviews() {
    try {
      return JSON.parse(localStorage.getItem(REVIEW_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  function saveReviews() {
    localStorage.setItem(REVIEW_KEY, JSON.stringify(state.reviews));
  }

  function auth() {
    var L = window.SlmLicense;
    if (!L || !L.enabled) {
      return { edit: true, suggest: true, approve: true, label: "Dev mode — all tools" };
    }
    var edit = !!(L.canEditKits && L.canEditKits());
    var suggest = !!L.canSuggest();
    var approve = !!L.canApprove();
    var label = "Browse only";
    if (approve && suggest) label = "Admin — edit, suggest, approve";
    else if (approve) label = "Approver — edit & publish";
    else if (suggest) label = "Suggestor — edit & suggest";
    return { edit: edit, suggest: suggest, approve: approve, label: label };
  }

  function applyAuthUi() {
    var a = auth();
    var role = $("stAuthRole");
    var note = $("stAuthNote");
    var editBtn = $("stModeEdit");
    if (role) role.textContent = a.label;
    if (note) {
      note.textContent = a.edit
        ? ""
        : "Your license can browse only. Ask for Suggest or Approve rights to edit kits.";
      note.classList.toggle("hidden", a.edit);
    }
    if (editBtn) {
      editBtn.disabled = !a.edit;
      editBtn.classList.toggle("is-locked", !a.edit);
      editBtn.title = a.edit
        ? "Edit recipes, rates, publish"
        : "Needs Suggest or Approve on your license";
    }
    if (!a.edit && state.mode === "edit") setMode("browse");
  }

  async function ensureAuth() {
    if (window.SlmLicense && window.SlmLicense.ensureLicensed) {
      await window.SlmLicense.ensureLicensed();
    }
    applyAuthUi();
    window.addEventListener("slm-license-changed", applyAuthUi);
  }

  function toast(msg) {
    var el = $("stToast");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.classList.add("hidden");
    }, 2400);
  }

  function arrLabel(a) {
    if (!a) return "";
    if (a === "InlineArr" || a === "In-line" || a === "INLINE") return "In-line";
    if (a === "Sectional" || a === "SECTIONAL") return "Section";
    return String(a);
  }

  function extLabel(e) {
    if (!e) return "";
    if (e === "NoExt" || e === "NO_EXT") return "No-ext";
    if (e === "WithExt" || e === "WITH_EXT") return "With-ext";
    return String(e);
  }

  function baseStatus(kit) {
    if (kit.enabled === false) return "off";
    if (!(kit.lines || []).length) return "empty";
    if (kit.complete) return "final";
    return "draft";
  }

  /** Visual workflow status: matrix + local suggest/finalize marks. */
  function displayStatus(kit) {
    var base = baseStatus(kit);
    if (base === "off") return "off";
    if (base === "final") return "final";
    var rev = state.reviews[kit.id];
    if (rev && rev.mark === "suggested") return "suggested";
    if (rev && rev.mark === "finalized") return "final";
    return base;
  }

  function locToken(loc) {
    if (loc === "Tangent") return "TAN";
    if (loc === "Angular") return "ANG";
    if (loc === "Dead-end") return "DE";
    if (loc === "T-Off") return "TOF";
    return "";
  }

  /** Best-effort turnkey SoR code from demo schedule (voltage · location · type). */
  function turnkeyCode(kit) {
    if (!kit || kit.family === "conductor") return "";
    var type = kit.structureLabel || kit.structure || "";
    if (type === "DTR") return "CTR-11-DTR";
    var loc = locToken(kit.location);
    if (!loc || !type) return "";
    if (kit.voltage === "33kV") return "CTR-33-" + loc + "-" + type;
    if (kit.voltage === "LT") return "CTR-LT-" + loc + "-" + type;
    return "CTR-11-" + loc + "-" + type;
  }

  function scheduleFor(kit) {
    var code = turnkeyCode(kit);
    if (!code) return null;
    return state.scheduleByCode[code] || null;
  }

  function hasScheduleLink(kit) {
    return !!scheduleFor(kit);
  }

  function structureKits() {
    return (state.matrix && state.matrix.structureKits) || [];
  }

  function kitsForVoltage(v) {
    return structureKits().filter(function (k) {
      return k.voltage === v;
    });
  }

  function matchesQuery(kit, q) {
    if (!q) return true;
    var hay = [
      kit.code,
      kit.structureLabel || kit.structure,
      kit.location,
      kit.arrangement,
      kit.conductorFamily,
      kit.conductorShort,
      kit.id,
    ]
      .join(" ")
      .toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function statusLabel(st) {
    if (st === "final") return "Final";
    if (st === "suggested") return "Suggested";
    if (st === "draft") return "Draft";
    if (st === "off") return "Off";
    return "Empty";
  }

  function filteredKits() {
    var q = state.q.trim().toLowerCase();
    return kitsForVoltage(state.voltage).filter(function (k) {
      if (!matchesQuery(k, q)) return false;
      if (state.status === "linked") return hasScheduleLink(k) && displayStatus(k) !== "off";
      if (state.status === "all") return displayStatus(k) !== "off";
      return displayStatus(k) === state.status;
    });
  }

  function groupByType(kits) {
    var order = [];
    var map = {};
    kits.forEach(function (k) {
      var key = k.structureLabel || k.structure || "?";
      if (!map[key]) {
        map[key] = [];
        order.push(key);
      }
      map[key].push(k);
    });
    order.sort(function (a, b) {
      var rank = function (s) {
        if (s === "1P") return 1;
        if (s === "2P") return 2;
        if (s === "3P") return 3;
        if (s === "4P") return 4;
        if (s === "DTR") return 5;
        return 9;
      };
      return rank(a) - rank(b) || a.localeCompare(b);
    });
    return order.map(function (key) {
      return { type: key, kits: map[key] };
    });
  }

  function countByStatus(voltage) {
    var counts = { final: 0, suggested: 0, draft: 0, empty: 0, off: 0, linked: 0, total: 0 };
    kitsForVoltage(voltage).forEach(function (k) {
      var st = displayStatus(k);
      counts.total += 1;
      if (counts[st] != null) counts[st] += 1;
      if (hasScheduleLink(k) && st !== "off") counts.linked += 1;
    });
    return counts;
  }

  function renderVoltRail() {
    var host = $("stVolt");
    if (!host) return;
    host.innerHTML = VOLTAGES.map(function (v) {
      var n = kitsForVoltage(v).length;
      return (
        '<button type="button" class="st-chip' +
        (state.voltage === v ? " is-active" : "") +
        '" data-v="' +
        esc(v) +
        '" role="tab" aria-selected="' +
        (state.voltage === v) +
        '"><span>' +
        esc(v) +
        '</span><span class="n">' +
        n +
        "</span></button>"
      );
    }).join("");
    host.querySelectorAll(".st-chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.voltage = btn.getAttribute("data-v");
        closeDrawer();
        render();
      });
    });
  }

  function renderStatusFilters() {
    var host = $("stStatusFilters");
    if (!host) return;
    var counts = countByStatus(state.voltage);
    host.innerHTML = STATUS_FILTERS.map(function (f) {
      var n =
        f.id === "all"
          ? counts.total - counts.off
          : counts[f.id] != null
            ? counts[f.id]
            : 0;
      return (
        '<button type="button" class="st-chip' +
        (state.status === f.id ? " is-active" : "") +
        '" data-st="' +
        f.id +
        '"><span>' +
        esc(f.label) +
        '</span><span class="n">' +
        n +
        "</span></button>"
      );
    }).join("");
    host.querySelectorAll(".st-chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.status = btn.getAttribute("data-st");
        renderGallery();
        renderProgress();
        renderStatusFilters();
      });
    });
  }

  function renderProgress() {
    var el = $("stProgress");
    if (!el) return;
    var c = countByStatus(state.voltage);
    var done = c.final;
    var open = c.suggested + c.draft + c.empty;
    el.innerHTML =
      "<div><strong>" +
      esc(state.voltage) +
      "</strong> progress</div>" +
      "<div><strong>" +
      done +
      "</strong> final · <strong>" +
      c.suggested +
      "</strong> suggested · <strong>" +
      c.draft +
      "</strong> draft · <strong>" +
      c.empty +
      "</strong> empty</div>" +
      "<div style=\"margin-top:6px;color:var(--muted)\">" +
      (open === 0
        ? "All active kits finalized for this voltage."
        : open + " still open for suggest / finalize.") +
      "</div>";
  }

  function cardHtml(kit) {
    var st = displayStatus(kit);
    var type = kit.structureLabel || kit.structure || "—";
    var parts = [];
    if (kit.location) parts.push('<span class="st-part loc">' + esc(kit.location) + "</span>");
    if (kit.arrangement)
      parts.push('<span class="st-part arr">' + esc(arrLabel(kit.arrangement)) + "</span>");
    var cond = kit.conductorShort || kit.conductorFamily || "";
    if (cond) parts.push('<span class="st-part cond">' + esc(cond) + "</span>");
    if (kit.extension && kit.extension !== "NoExt")
      parts.push('<span class="st-part ext">' + esc(extLabel(kit.extension)) + "</span>");

    var sch = scheduleFor(kit);
    var schHtml = sch
      ? '<div class="st-sched" title="' +
        esc(sch.description || "") +
        '"><span class="st-sched-label">SoR</span> ' +
        esc(sch.code) +
        "</div>"
      : '<div class="st-sched st-sched-miss">No turnkey link</div>';

    return (
      '<button type="button" class="st-card' +
      (state.selectedId === kit.id ? " is-selected" : "") +
      '" data-id="' +
      esc(kit.id) +
      '">' +
      '<div class="st-card-top">' +
      '<div class="st-card-type">' +
      esc(type) +
      "</div>" +
      '<span class="st-pill ' +
      st +
      '">' +
      esc(statusLabel(st)) +
      "</span>" +
      "</div>" +
      '<div class="st-flow">' +
      parts.join("") +
      "</div>" +
      schHtml +
      '<div class="st-card-code">' +
      esc(kit.code || kit.id) +
      "</div>" +
      "</button>"
    );
  }

  function renderGallery() {
    var host = $("stGallery");
    var title = $("stTitle");
    var hint = $("stHint");
    if (!host) return;

    if (title) title.textContent = state.voltage + " structures";
    if (hint)
      hint.textContent =
        "Colour-coded flow parts · tap a card for detail & review status";

    var kits = filteredKits();
    var groups = groupByType(kits);
    if (!groups.length) {
      host.innerHTML =
        '<div class="st-empty-state">No structures match this filter.</div>';
      return;
    }

    host.innerHTML = groups
      .map(function (g) {
        return (
          '<section class="st-group">' +
          '<div class="st-group-head"><h2>' +
          esc(g.type) +
          "</h2><span>" +
          g.kits.length +
          "</span></div>" +
          '<div class="st-cards">' +
          g.kits.map(cardHtml).join("") +
          "</div></section>"
        );
      })
      .join("");

    host.querySelectorAll(".st-card").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openDrawer(btn.getAttribute("data-id"));
      });
    });
  }

  function findKit(id) {
    return structureKits().find(function (k) {
      return k.id === id;
    });
  }

  function openDrawer(id) {
    var kit = findKit(id);
    if (!kit) return;
    state.selectedId = id;
    var drawer = $("stDrawer");
    var scrim = $("stScrim");
    var title = $("stDrawerTitle");
    var sub = $("stDrawerSub");
    var body = $("stDrawerBody");
    var foot = $("stDrawerFoot");
    var st = displayStatus(kit);

    if (title)
      title.textContent =
        (kit.structureLabel || kit.structure || "Structure") +
        " · " +
        (kit.location || "");
    if (sub) sub.textContent = kit.code || kit.id;

    var lines = (kit.lines || [])
      .slice(0, 40)
      .map(function (ln) {
        return (
          '<div class="st-line"><span>' +
          esc(ln.code || ln.id || "—") +
          " · " +
          esc(ln.type || "") +
          "</span><span>" +
          esc(ln.qty) +
          "</span></div>"
        );
      })
      .join("");

    var sch = scheduleFor(kit);
    var schBlock = sch
      ? "<dt>Turnkey SoR</dt><dd><strong>" +
        esc(sch.code) +
        "</strong><br><span style=\"color:var(--muted);font-weight:500\">" +
        esc(sch.description || "") +
        (sch.rate != null ? " · ₹" + Number(sch.rate).toLocaleString("en-IN") : "") +
        "</span></dd>"
      : "<dt>Turnkey SoR</dt><dd style=\"color:var(--muted)\">No demo schedule match for this combination</dd>";

    if (body) {
      body.innerHTML =
        '<dl class="st-kv">' +
        "<dt>Voltage</dt><dd>" +
        esc(kit.voltage) +
        "</dd>" +
        "<dt>Type</dt><dd>" +
        esc(kit.structureLabel || kit.structure) +
        "</dd>" +
        "<dt>Location</dt><dd>" +
        esc(kit.location || "—") +
        "</dd>" +
        "<dt>Arrangement</dt><dd>" +
        esc(arrLabel(kit.arrangement) || "—") +
        "</dd>" +
        "<dt>Conductor</dt><dd>" +
        esc(kit.conductorShort || kit.conductorFamily || "—") +
        "</dd>" +
        "<dt>Extension</dt><dd>" +
        esc(extLabel(kit.extension) || "—") +
        "</dd>" +
        "<dt>Status</dt><dd><span class=\"st-pill " +
        st +
        '">' +
        esc(statusLabel(st)) +
        "</span></dd>" +
        schBlock +
        "</dl>" +
        '<div class="st-lines"><h3>Recipe lines</h3>' +
        (lines || "<p style=\"color:var(--muted)\">No lines yet (empty kit).</p>") +
        "</div>";
    }

    if (foot) {
      var a = auth();
      var bits = [];
      if (a.suggest) {
        bits.push(
          '<button type="button" class="st-btn st-btn-warn" id="stMarkSuggested">Mark suggested</button>'
        );
        bits.push(
          '<button type="button" class="st-btn" id="stMarkClear">Clear mark</button>'
        );
      } else {
        bits.push(
          '<span class="st-auth-lock">Suggest needs <strong>can_suggest</strong> on your license</span>'
        );
      }
      if (a.edit) {
        bits.push(
          '<button type="button" class="st-btn st-btn-primary" id="stEditKit">Edit kit</button>'
        );
      } else {
        bits.push(
          '<span class="st-auth-lock">Edit needs Suggest or Approve rights</span>'
        );
      }
      foot.innerHTML = bits.join("");
      var sug = $("stMarkSuggested");
      var clr = $("stMarkClear");
      var editBtn = $("stEditKit");
      if (sug)
        sug.addEventListener("click", function () {
          if (!auth().suggest) {
            toast("Suggest not allowed on this license");
            return;
          }
          state.reviews[kit.id] = { mark: "suggested", at: Date.now() };
          saveReviews();
          toast("Marked suggested");
          openDrawer(kit.id);
          render();
        });
      if (clr)
        clr.addEventListener("click", function () {
          if (!auth().suggest) return;
          delete state.reviews[kit.id];
          saveReviews();
          toast("Review mark cleared");
          openDrawer(kit.id);
          render();
        });
      if (editBtn)
        editBtn.addEventListener("click", function () {
          if (!auth().edit) {
            toast("Edit not allowed on this license");
            return;
          }
          closeDrawer();
          setMode("edit", { kit: kit.id });
        });
    }

    if (drawer) drawer.classList.remove("hidden");
    if (scrim) scrim.classList.remove("hidden");
    renderGallery();
  }

  function closeDrawer() {
    state.selectedId = null;
    var drawer = $("stDrawer");
    var scrim = $("stScrim");
    if (drawer) drawer.classList.add("hidden");
    if (scrim) scrim.classList.add("hidden");
    renderGallery();
  }

  function render() {
    renderVoltRail();
    renderStatusFilters();
    renderProgress();
    renderGallery();
  }

  function editFrameUrl(opts) {
    var o = opts || {};
    var q = new URLSearchParams();
    q.set("embed", "1");
    if (o.kit) q.set("kit", o.kit);
    if (o.tab) q.set("tab", o.tab);
    return "../estimate/?" + q.toString();
  }

  function setMode(mode, opts) {
    var next = mode === "edit" ? "edit" : "browse";
    if (next === "edit" && !auth().edit) {
      toast("Edit needs Suggest or Approve on your license");
      applyAuthUi();
      return;
    }
    state.mode = next;
    var browseTools = $("stBrowseTools");
    var editHint = $("stEditHint");
    var browseMain = $("stBrowseMain");
    var editMain = $("stEditMain");
    var frame = $("stEditFrame");

    document.querySelectorAll("#stModeNav [data-mode]").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-mode") === next);
    });

    if (browseTools) browseTools.classList.toggle("hidden", next === "edit");
    if (editHint) editHint.classList.toggle("hidden", next !== "edit");
    if (browseMain) browseMain.classList.toggle("hidden", next === "edit");
    if (editMain) editMain.classList.toggle("hidden", next !== "edit");

    if (next === "edit" && frame) {
      var url = editFrameUrl(opts);
      var needReload =
        !state.editLoaded ||
        (opts && (opts.kit || opts.tab || opts.force));
      if (needReload) {
        frame.src = url;
        state.editLoaded = true;
      }
    }

    try {
      var u = new URL(location.href);
      if (next === "edit") u.searchParams.set("mode", "edit");
      else u.searchParams.delete("mode");
      if (opts && opts.kit) u.searchParams.set("kit", opts.kit);
      else if (next === "browse") u.searchParams.delete("kit");
      if (opts && opts.tab) u.searchParams.set("tab", opts.tab);
      else if (next === "browse") u.searchParams.delete("tab");
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    } catch (e) {
      /* ignore */
    }
  }

  function boot() {
    $("stDrawerClose")?.addEventListener("click", closeDrawer);
    $("stScrim")?.addEventListener("click", closeDrawer);
    $("stSearch")?.addEventListener("input", function (e) {
      state.q = e.target.value || "";
      renderGallery();
    });

    document.querySelectorAll("#stModeNav [data-mode]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setMode(btn.getAttribute("data-mode"));
      });
    });

    ensureAuth().then(function () {
      return Promise.all([
        fetch(MATRIX_URL).then(function (r) {
          if (!r.ok) throw new Error("Could not load kit-matrix.json (" + r.status + ")");
          return r.json();
        }),
        fetch(SCHEDULE_URL)
          .then(function (r) {
            return r.ok ? r.json() : null;
          })
          .catch(function () {
            return null;
          }),
      ]);
    })
      .then(function (pair) {
        state.matrix = pair[0];
        state.scheduleByCode = Object.create(null);
        ((pair[1] && pair[1].items) || []).forEach(function (it) {
          if (it && it.code) state.scheduleByCode[it.code] = it;
        });
        $("stLoading")?.classList.add("hidden");
        render();
        applyAuthUi();

        var params = new URLSearchParams(location.search);
        if (
          auth().edit &&
          (params.get("mode") === "edit" || params.get("kit") || params.get("tab"))
        ) {
          setMode("edit", {
            kit: params.get("kit") || "",
            tab: params.get("tab") || "",
            force: true,
          });
        } else {
          setMode("browse");
        }
      })
      .catch(function (err) {
        $("stLoading")?.classList.add("hidden");
        var errEl = $("stError");
        if (errEl) {
          errEl.classList.remove("hidden");
          errEl.textContent = String(err.message || err);
        }
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
