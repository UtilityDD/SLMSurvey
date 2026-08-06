/**
 * Map desk — import / open / demo, verify poles, print, estimate.
 */
(function (global) {
  "use strict";

  var Desk = global.SlmDesk;
  var WS = global.SlmWorkspace;
  var Cat = global.SlmCatalog;
  var Net = global.SlmNetworkCatalog;
  var esc = function (s) {
    return Desk.escapeHtml(s);
  };

  var selectedId = null;
  var poleFilter = "";
  var lastReport = null;
  var estTimer = null;

  function effective() {
    return WS.effectiveSurvey(WS.get());
  }

  function assets() {
    var s = effective();
    return (s && s.assets) || [];
  }

  function rawAssets() {
    var s = WS.get().survey;
    return (s && s.assets) || [];
  }

  function findRawAsset(id) {
    return rawAssets().find(function (a) {
      return String(a.id) === String(id);
    });
  }

  function findAsset(id) {
    return assets().find(function (a) {
      return String(a.id) === String(id);
    });
  }

  function counts() {
    var list = assets();
    var proposed = list.filter(function (a) {
      return String(a.status || "").toLowerCase() === "proposed";
    }).length;
    return { poles: list.length, proposed: proposed };
  }

  /** One entry: phone survey JSON or a saved desktop workspace. */
  function openMap() {
    if (WS.openFromFile) {
      WS.openFromFile()
        .then(function () {
          if (WS.forgetFile) WS.forgetFile();
          selectedId = null;
          Desk.toast("Opened");
          Desk.refresh();
        })
        .catch(function (err) {
          if (err && err.name === "AbortError") return;
          Desk.toast((err && err.message) || "Could not open that file");
        });
      return;
    }
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".slmmap,.json,application/json";
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(String(reader.result || ""));
          if (WS.ingestFileData) WS.ingestFileData(data);
          else throw new Error("bad");
          selectedId = null;
          Desk.toast("Opened");
          Desk.refresh();
        } catch (e) {
          Desk.toast((e && e.message) || "Could not open that file");
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  function loadDemo() {
    // Bust HTTP cache — old illegal demo combos were stuck in browser cache /
    // localStorage and kept showing “9 gaps”.
    var url =
      "../demo/sample_workspace_33_11_lt.json?v=" +
      encodeURIComponent(String(Date.now()));
    fetch(url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("missing");
        return r.json();
      })
      .then(function (data) {
        if (WS.forgetFile) WS.forgetFile();
        var survey = legalizeSurvey(data) || data;
        WS.update(function (w) {
          w.survey = survey;
          w.poleOverrides = {};
          w.assemblies = [];
          w.name = survey.title || "Demo map";
        }, "demo");
        selectedId = null;
        lastReport = null;
        Desk.toast("Demo loaded");
        Desk.refresh();
      })
      .catch(function () {
        Desk.toast("Demo file missing");
      });
  }

  /**
   * Force a pole into NetworkCatalog + kit-match legal shape.
   * Surveys must never leave the predefined kit matrix.
   */
  function legalizeAsset(asset) {
    if (!asset) return asset;
    var next = Object.assign({}, asset);
    var voltage = next.voltage;

    if (Net && Net.optionsFor) {
      var pack = Net.optionsFor(voltage, {
        structure: next.structure,
        kitLocation: next.kitLocation,
        kitArrangement: next.kitArrangement,
        kitExtension: next.kitExtension,
        conductor: next.conductor,
        poleMaterial: next.poleMaterial,
      });
      next.structure = pack.draft.structure;
      next.kitLocation = pack.draft.kitLocation;
      next.kitArrangement = pack.draft.kitArrangement || null;
      next.kitExtension = pack.draft.kitExtension;
      if (pack.draft.conductor) next.conductor = pack.draft.conductor;
    }

    // HT 2P/3P/4P/DTR → Sectional only (Dead-end has no arrangement).
    if (
      (voltage === "33kV" || voltage === "11kV") &&
      next.structure &&
      next.structure !== "1P" &&
      next.kitLocation !== "Dead-end"
    ) {
      next.kitArrangement = "Sectional";
    }
    if (next.kitLocation === "Dead-end") next.kitArrangement = null;

    // LT: no extension; ABC → 3P only; PVC not 2P.
    if (voltage === "LT") {
      next.kitExtension = "No ext";
      var c = String(next.conductor || "").toUpperCase();
      if (c === "ABC") next.structure = "3P";
      if (c === "PVC" && next.structure === "2P") next.structure = "1P";
    }

    if (next.structure === "DTR") {
      if (!next.dtrMount) next.dtrMount = "2P";
      if (!next.dtCapacityKva) next.dtCapacityKva = "63";
      if (next.kitLocation !== "Dead-end") next.kitArrangement = "Sectional";
    }

    // kitWire for matcher
    var cond = String(next.conductor || "").toUpperCase();
    if (cond === "ABC" || cond === "PVC") next.kitWire = null;
    else if (voltage === "LT") {
      if (next.structure === "2P") next.kitWire = "3W";
      else if (next.structure === "3P") next.kitWire = "4W";
      else next.kitWire = "2W";
    } else next.kitWire = "3W";

    return next;
  }

  function legalizeSurvey(survey) {
    if (!survey || !survey.assets) return survey;
    return Object.assign({}, survey, {
      assets: survey.assets.map(legalizeAsset),
    });
  }

  /** If stored survey has illegal kit tags (old demo), rewrite once. */
  function repairStoredSurveyIfNeeded() {
    var ws = WS.get();
    if (!ws.survey || !ws.survey.assets) return false;
    var fixed = legalizeSurvey(ws.survey);
    var changed = false;
    for (var i = 0; i < ws.survey.assets.length; i++) {
      var a = ws.survey.assets[i];
      var b = fixed.assets[i];
      if (
        a.structure !== b.structure ||
        a.kitLocation !== b.kitLocation ||
        a.kitArrangement !== b.kitArrangement ||
        a.kitExtension !== b.kitExtension ||
        a.conductor !== b.conductor ||
        String(a.kitWire || "") !== String(b.kitWire || "") ||
        String(a.dtrMount || "") !== String(b.dtrMount || "") ||
        String(a.dtCapacityKva || "") !== String(b.dtCapacityKva || "")
      ) {
        changed = true;
        break;
      }
    }
    if (!changed) return false;
    WS.update(function (w) {
      w.survey = fixed;
    }, "legalize");
    return true;
  }

  function openPrint() {
    var survey = effective();
    if (!survey || !survey.assets || !survey.assets.length) {
      Desk.toast("Open a map first");
      return;
    }
    // Lean payload — enough for CAD print, smaller handoff.
    var payload = {
      survey: {
        surveyId: survey.surveyId,
        title: survey.title,
        linemanName: survey.linemanName,
        linemanMobile: survey.linemanMobile,
        organization: survey.organization,
        utility: survey.utility,
        assets: survey.assets,
        connections: survey.connections || [],
      },
      settings: {},
      exportKind: "",
    };
    var raw;
    try {
      raw = JSON.stringify(payload);
      sessionStorage.setItem("slm_job_print_map_v1", raw);
      localStorage.setItem("slm_job_print_map_v1", raw);
    } catch (e) {
      // Still try window.name below.
      try {
        raw = JSON.stringify(payload);
      } catch (e2) {
        Desk.toast("Could not hand off map");
        return;
      }
    }

    // window.name survives same-tab navigation even on file:// (storage often does not).
    try {
      window.name = "slmprint:" + raw;
    } catch (e) {
      Desk.toast("Could not hand off map");
      return;
    }

    location.assign("../index.html?cad=1&print=1&simple=1");
  }

  function ensureAssemblies() {
    return Cat.load().then(function () {
      var ws = WS.get();
      var survey = effective();
      if (!survey || !global.SlmEstimateMatch) return;
      var hits = global.SlmEstimateMatch.collectKitHits(survey, Cat.all());
      var add = [];
      hits.structureQty.forEach(function (entry) {
        if (!WS.hasAssembly(ws, entry.kit.id)) add.push(entry.kit);
      });
      if (!add.length) return;
      WS.update(function (w) {
        add.forEach(function (kit) {
          if (!WS.hasAssembly(w, kit.id)) w.assemblies.push(kit);
        });
      }, "kits");
    });
  }

  function money(n) {
    var Match = global.SlmEstimateMatch;
    if (Match && Match.money) return Match.money(n);
    if (n == null || isNaN(n)) return "—";
    return (
      "₹" +
      Number(n).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  function fmtQty(n) {
    if (n == null || isNaN(n)) return "—";
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return Number(n)
      .toFixed(3)
      .replace(/\.?0+$/, "");
  }

  /** Survey with unsaved pole-panel draft applied (live estimate). */
  function surveyForEstimate() {
    var survey = effective();
    if (!survey) return null;
    survey = legalizeSurvey(survey);
    var panel = document.getElementById("dkPolePanel");
    if (!panel || !panel._assetId || !panel._draft) return survey;
    var draft = panel._draft;
    var assets = (survey.assets || []).map(function (a) {
      if (String(a.id) !== String(panel._assetId)) return a;
      return legalizeAsset(
        Object.assign({}, a, {
          structure: draft.structure,
          kitLocation: draft.kitLocation,
          kitArrangement: draft.kitArrangement,
          kitExtension: draft.kitExtension,
          conductor: draft.conductor,
          poleMaterial: draft.poleMaterial,
        })
      );
    });
    return Object.assign({}, survey, { assets: assets });
  }

  function computeReport() {
    var Match = global.SlmEstimateMatch;
    if (!Match || !Cat) return Promise.resolve(null);
    return Cat.load().then(function () {
      var survey = surveyForEstimate();
      if (!survey) return null;
      var ratebook = WS.ratebook ? WS.ratebook(WS.get()) : { materials: [], labour: [] };
      if (
        !(ratebook.materials || []).length &&
        !(ratebook.labour || []).length &&
        Cat.bundledRatebook
      ) {
        ratebook = Cat.bundledRatebook();
      }
      var extras = (WS.get() && WS.get().extras) || Match.defaultExtras();
      return Match.buildReport(survey, Cat.all(), ratebook, extras);
    });
  }

  function closeScheduleModal() {
    var root = document.getElementById("dkScheduleModal");
    if (root) root.classList.add("hidden");
  }

  function openScheduleModal(kind) {
    var report = lastReport;
    if (!report) return;
    var title = "Schedule";
    var rows = [];
    var total = 0;
    var extra = "";
    if (kind === "material") {
      title = "Schedule of materials";
      rows = report.materialSchedule || [];
      total = report.materialTotal || 0;
    } else if (kind === "labour") {
      title = "Schedule of labour";
      rows = report.labourSchedule || [];
      total = report.labourTotal || 0;
    } else if (kind === "abstract") {
      title = "Estimated cost";
      var abs = report.abstract || {};
      extra =
        '<div class="dk-sched-abstract">' +
        (abs.steps || [])
          .map(function (s) {
            return (
              '<div class="dk-sched-abs-row"><span>' +
              esc(s.label) +
              "</span><strong>" +
              esc(money(s.amount)) +
              "</strong></div>"
            );
          })
          .join("") +
        '<div class="dk-sched-abs-row is-total"><span>Grand total (say)</span><strong>' +
        esc(money(abs.grandTotalRounded != null ? abs.grandTotalRounded : abs.grandTotal)) +
        "</strong></div>" +
        (abs.amountInWords
          ? '<p class="dk-sched-words">' + esc(abs.amountInWords) + "</p>"
          : "") +
        "</div>";
    }

    var root = document.getElementById("dkScheduleModal");
    if (!root) {
      root = document.createElement("div");
      root.id = "dkScheduleModal";
      root.className = "dk-modal-root hidden";
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-modal", "true");
      document.body.appendChild(root);
      root.addEventListener("click", function (e) {
        if (e.target === root) closeScheduleModal();
      });
    }

    var body =
      kind === "abstract"
        ? extra
        : '<div class="dk-sched-scroll"><table class="dk-sched-table"><thead><tr>' +
          "<th>Sl.</th><th>Code</th><th>Description</th><th>Unit</th>" +
          '<th class="dk-num">Qty</th><th class="dk-num">Rate (₹)</th><th class="dk-num">Amount (₹)</th>' +
          "</tr></thead><tbody>" +
          (rows.length
            ? rows
                .map(function (r) {
                  return (
                    "<tr><td>" +
                    esc(String(r.sl)) +
                    "</td><td>" +
                    esc(r.code || "") +
                    "</td><td>" +
                    esc(r.description || "") +
                    "</td><td>" +
                    esc(r.unit || "") +
                    '</td><td class="dk-num">' +
                    esc(fmtQty(r.qty)) +
                    '</td><td class="dk-num">' +
                    esc(money(r.rate).replace(/^₹/, "")) +
                    '</td><td class="dk-num">' +
                    esc(money(r.amount).replace(/^₹/, "")) +
                    "</td></tr>"
                  );
                })
                .join("")
            : '<tr><td colspan="7" class="dk-sched-empty">No items</td></tr>') +
          '</tbody><tfoot><tr><td colspan="6">Total</td><td class="dk-num">' +
          esc(money(total).replace(/^₹/, "")) +
          "</td></tr></tfoot></table></div>";

    root.innerHTML =
      '<div class="dk-modal-card dk-modal-wide">' +
      '<div class="dk-modal-head"><h2>' +
      esc(title) +
      '</h2><button type="button" class="dk-icon-btn" id="dkSchedClose" title="Close">×</button></div>' +
      '<div class="dk-modal-body">' +
      body +
      "</div></div>";
    root.classList.remove("hidden");
    var closeBtn = root.querySelector("#dkSchedClose");
    if (closeBtn) closeBtn.addEventListener("click", closeScheduleModal);
    if (!openScheduleModal._esc) {
      openScheduleModal._esc = true;
      document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        var m = document.getElementById("dkScheduleModal");
        if (m && !m.classList.contains("hidden")) closeScheduleModal();
      });
    }
  }

  function paintEstimatePanel(report) {
    lastReport = report;
    var panel = document.getElementById("dkEstPanel");
    if (!panel) return;
    if (!report) {
      panel.innerHTML = '<div class="dk-side-muted">No estimate</div>';
      return;
    }
    var abs = report.abstract || {};
    var scheme = (Number(report.materialTotal) || 0) + (Number(report.labourTotal) || 0);
    var total =
      abs.grandTotalRounded != null
        ? abs.grandTotalRounded
        : abs.grandTotal != null
          ? abs.grandTotal
          : report.totalAmount || 0;
    var gapN = (report.gaps || []).length;
    panel.innerHTML =
      '<div class="dk-cost">' +
      '<button type="button" class="dk-cost-row is-link" data-sched="material">' +
      "<span>Materials</span><strong>" +
      esc(money(report.materialTotal)) +
      "</strong></button>" +
      '<button type="button" class="dk-cost-row is-link" data-sched="labour">' +
      "<span>Labour</span><strong>" +
      esc(money(report.labourTotal)) +
      "</strong></button>" +
      '<div class="dk-cost-row"><span>Scheme</span><strong>' +
      esc(money(scheme)) +
      "</strong></div>" +
      '<button type="button" class="dk-cost-row dk-cost-total is-link" data-sched="abstract">' +
      "<span>Estimated</span><strong>" +
      esc(money(total)) +
      "</strong></button>" +
      (gapN
        ? '<div class="dk-cost-gaps">' + gapN + " gap" + (gapN === 1 ? "" : "s") + "</div>"
        : "") +
      "</div>";

    panel.querySelectorAll("[data-sched]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openScheduleModal(btn.getAttribute("data-sched"));
      });
    });
  }

  function refreshEstimate(immediate) {
    clearTimeout(estTimer);
    var run = function () {
      computeReport()
        .then(paintEstimatePanel)
        .catch(function () {
          paintEstimatePanel(null);
        });
    };
    if (immediate) run();
    else estTimer = setTimeout(run, 160);
  }

  function packFor(asset) {
    var draft = {
      structure: asset.structure,
      kitLocation: asset.kitLocation,
      kitArrangement: asset.kitArrangement,
      kitExtension: asset.kitExtension,
      conductor: asset.conductor,
      poleMaterial: asset.poleMaterial,
    };
    if (Net && Net.optionsFor) return Net.optionsFor(asset.voltage, draft);
    return {
      structures: ["1P", "2P", "3P", "4P", "DTR"],
      locations: ["Tangent", "Angular", "Dead-end", "T-Off"],
      arrangements: ["In-line", "Sectional"],
      extensions: ["No ext", "With ext"],
      conductors: [],
      draft: draft,
    };
  }

  function matchKitForDraft(asset, draft) {
    var Match = global.SlmEstimateMatch;
    if (!Match || !Match.findStructureKit || !Cat) return null;
    var pole = Object.assign({}, asset, draft || {});
    var kits = (Cat.all() || []).filter(function (k) {
      return k.family === "structure" && k.enabled !== false;
    });
    return Match.findStructureKit(pole, kits, false);
  }

  function kitLineQty(line) {
    if (line.qtyPerUnit != null) return line.qtyPerUnit;
    if (line.qty != null) return line.qty;
    if (line.quantity != null) return line.quantity;
    return 1;
  }

  function canEditKits() {
    var L = global.SlmLicense;
    if (!L || !L.enabled) return true;
    return !!(L.canEditKits && L.canEditKits());
  }

  function closeKitModal() {
    var root = document.getElementById("dkKitModal");
    if (root) root.classList.add("hidden");
  }

  function refreshKitFromCatalog(kitId) {
    if (!kitId || !Cat || !Cat.getById) return null;
    try {
      return Cat.getById(kitId) || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * View kit recipe in-modal. Admins can switch to the same embed editor
   * used on Structures — without leaving the Map desk.
   */
  function openKitModal(kit, opts) {
    if (!kit) return;
    opts = opts || {};
    var editing = !!opts.edit && canEditKits();
    var Match = global.SlmEstimateMatch;
    var live = refreshKitFromCatalog(kit.id) || kit;
    var title =
      (Match && Match.kitTitle && Match.kitTitle(live)) ||
      live.name ||
      live.label ||
      live.id ||
      "Kit";
    var sub = [
      live.structureLabel || live.structure,
      live.location || live.kitLocation,
      live.arrangementLabel || live.arrangement,
      live.extensionLabel || live.extension,
      live.conductorShort || live.conductorFamily || live.conductor,
    ]
      .filter(Boolean)
      .join(" · ");
    var lines = live.lines || [];
    var admin = canEditKits();

    var root = document.getElementById("dkKitModal");
    if (!root) {
      root = document.createElement("div");
      root.id = "dkKitModal";
      root.className = "dk-modal-root hidden";
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-modal", "true");
      document.body.appendChild(root);
      root.addEventListener("click", function (e) {
        if (e.target === root) closeKitModal();
      });
    }

    var body;
    var actions;
    if (editing) {
      body =
        '<iframe class="dk-kit-embed" title="Edit kit" src="../estimate/?embed=1&kit=' +
        encodeURIComponent(live.id || "") +
        '"></iframe>';
      actions =
        '<button type="button" class="dk-btn dk-btn-sm" id="dkKitBack">← Recipe</button>' +
        '<button type="button" class="dk-btn dk-btn-sm" id="dkKitDone">Close</button>';
    } else {
      body =
        '<p class="dk-kit-modal-meta">' +
        esc(live.id || "") +
        " · " +
        lines.length +
        " lines</p>" +
        '<div class="dk-sched-scroll"><table class="dk-sched-table"><thead><tr>' +
        '<th>Code</th><th>Type</th><th class="dk-num">Qty</th></tr></thead><tbody>' +
        (lines.length
          ? lines
              .map(function (l) {
                return (
                  "<tr><td>" +
                  esc(l.itemId || l.code || l.matCode || "—") +
                  "</td><td>" +
                  esc(l.type || "") +
                  '</td><td class="dk-num">' +
                  esc(String(kitLineQty(l))) +
                  "</td></tr>"
                );
              })
              .join("")
          : '<tr><td colspan="3" class="dk-sched-empty">No recipe lines</td></tr>') +
        "</tbody></table></div>";
      actions =
        (admin
          ? '<button type="button" class="dk-btn dk-btn-primary dk-btn-sm" id="dkKitEdit">Edit kit</button>'
          : "") +
        '<button type="button" class="dk-btn dk-btn-sm" id="dkKitDone">Close</button>';
    }

    root.innerHTML =
      '<div class="dk-modal-card dk-modal-wide' +
      (editing ? " is-editing" : "") +
      '">' +
      '<div class="dk-modal-head"><div class="dk-modal-head-text"><h2>' +
      esc(editing ? "Edit kit" : title) +
      "</h2>" +
      (sub && !editing
        ? '<p class="dk-modal-sub">' + esc(sub) + "</p>"
        : editing
          ? '<p class="dk-modal-sub">' + esc(title) + "</p>"
          : "") +
      '</div><button type="button" class="dk-icon-btn" id="dkKitClose" title="Close">×</button></div>' +
      '<div class="dk-modal-body' +
      (editing ? " is-embed" : "") +
      '">' +
      body +
      (editing ? "" : '<div class="dk-modal-actions">' + actions + "</div>") +
      "</div>" +
      (editing
        ? '<div class="dk-modal-actions dk-modal-actions-bar">' + actions + "</div>"
        : "") +
      "</div>";

    root.classList.remove("hidden");

    var closeBtn = root.querySelector("#dkKitClose");
    var doneBtn = root.querySelector("#dkKitDone");
    var backBtn = root.querySelector("#dkKitBack");
    var editBtn = root.querySelector("#dkKitEdit");
    if (closeBtn) closeBtn.addEventListener("click", closeKitModal);
    if (doneBtn) doneBtn.addEventListener("click", closeKitModal);
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        // Prefer refreshed catalog copy after save in embed.
        if (Cat && Cat.load) {
          Cat.load()
            .then(function () {
              openKitModal(refreshKitFromCatalog(live.id) || live, { edit: false });
            })
            .catch(function () {
              openKitModal(live, { edit: false });
            });
        } else {
          openKitModal(live, { edit: false });
        }
      });
    }
    if (editBtn) {
      editBtn.addEventListener("click", function () {
        openKitModal(live, { edit: true });
      });
    }
    if (!openKitModal._esc) {
      openKitModal._esc = true;
      document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        var m = document.getElementById("dkKitModal");
        if (m && !m.classList.contains("hidden")) closeKitModal();
      });
    }
  }

  function renderPoleEditor(panel, assetId, draftIn) {
    var asset = findAsset(assetId);
    if (!asset) return;
    var ov = (WS.get().poleOverrides || {})[asset.id] || {};
    var draft = Object.assign({}, asset, ov, draftIn || {});
    var pack = packFor(Object.assign({}, draft, { voltage: asset.voltage }));
    draft = Object.assign({}, draft, pack.draft || {});
    var matchedKit = null;

    function chipRow(label, key, options, current) {
      return (
        '<div class="dk-field">' +
        '<span class="dk-field-label">' +
        esc(label) +
        "</span>" +
        '<div class="dk-chips" data-key="' +
        esc(key) +
        '">' +
        (options || [])
          .map(function (o) {
            var val = typeof o === "string" ? o : o.id || o.label;
            var lab = typeof o === "string" ? o : o.label || o.id;
            return (
              '<button type="button" class="dk-chip' +
              (String(current) === String(val) ? " is-on" : "") +
              '" data-val="' +
              esc(val) +
              '">' +
              esc(lab) +
              "</button>"
            );
          })
          .join("") +
        "</div></div>"
      );
    }

    function paint(kit) {
      matchedKit = kit;
      var seq = String(asset.sequence != null ? asset.sequence : asset.id);
      panel.innerHTML =
        '<div class="dk-pole-head">' +
        "<h3>P" +
        esc(seq) +
        '</h3><span class="dk-volt-pill">' +
        esc(asset.voltage || "—") +
        '</span><button type="button" class="dk-icon-btn" id="dkPoleClose" title="Close">×</button></div>' +
        chipRow("Structure", "structure", pack.structures, draft.structure) +
        chipRow("Location", "kitLocation", pack.locations, draft.kitLocation) +
        chipRow("Arrange", "kitArrangement", pack.arrangements, draft.kitArrangement) +
        chipRow("Ext", "kitExtension", pack.extensions, draft.kitExtension) +
        (pack.conductors && pack.conductors.length
          ? chipRow("Wire", "conductor", pack.conductors, draft.conductor)
          : "") +
        '<div class="dk-kit-row">' +
        '<button type="button" class="dk-btn dk-btn-sm" id="dkPoleViewKit"' +
        (kit ? "" : " disabled") +
        ">View kit</button>" +
        (kit ? "" : '<span class="dk-kit-miss">No match</span>') +
        "</div>" +
        '<div class="dk-actions-row">' +
        '<button type="button" class="dk-btn dk-btn-primary dk-btn-sm" id="dkPoleSave">Save</button>' +
        "</div>";

      wire();
    }

    function wire() {
      panel.querySelectorAll(".dk-chips").forEach(function (row) {
        row.addEventListener("click", function (e) {
          var btn = e.target.closest(".dk-chip");
          if (!btn) return;
          var key = row.getAttribute("data-key");
          state[key] = btn.getAttribute("data-val");
          var nextPack = packFor(Object.assign({}, asset, state));
          state = Object.assign({}, state, nextPack.draft || {});
          panel._draft = state;
          renderPoleEditor(panel, asset.id, state);
          refreshEstimate();
        });
      });

      var viewBtn = panel.querySelector("#dkPoleViewKit");
      if (viewBtn) {
        viewBtn.addEventListener("click", function () {
          if (!matchedKit) return;
          openKitModal(matchedKit);
        });
      }

      panel.querySelector("#dkPoleSave").addEventListener("click", function () {
        var raw = findRawAsset(panel._assetId);
        var next = panel._draft || state;
        if (!raw) return;
        var patch = {};
        ["structure", "kitLocation", "kitArrangement", "kitExtension", "conductor"].forEach(
          function (k) {
            var v = String(next[k] || "").trim();
            if (v && v !== String(raw[k] || "")) patch[k] = v;
          }
        );
        WS.update(function (w) {
          if (Object.keys(patch).length) w.poleOverrides[raw.id] = patch;
          else delete w.poleOverrides[raw.id];
        }, "poles");
        Desk.toast("Saved");
        Desk.refresh();
      });
      panel.querySelector("#dkPoleClose").addEventListener("click", function () {
        selectedId = null;
        Desk.refresh();
      });
    }

    var state = {
      structure: draft.structure,
      kitLocation: draft.kitLocation,
      kitArrangement: draft.kitArrangement,
      kitExtension: draft.kitExtension,
      conductor: draft.conductor,
      poleMaterial: draft.poleMaterial || asset.poleMaterial,
    };
    panel._draft = state;
    panel._assetId = asset.id;

    paint(null);
    if (!Cat) return;
    Cat.load()
      .then(function () {
        if (panel._assetId !== asset.id) return;
        paint(matchKitForDraft(asset, state));
      })
      .catch(function () {
        if (panel._assetId !== asset.id) return;
        paint(null);
      });
  }

  function renderBlank(host) {
    host.innerHTML =
      '<div class="dk-page"><div class="dk-blank">' +
      "<h2>Open a survey map</h2>" +
      "<p>Open a phone export or saved file, or try the demo.</p>" +
      '<div class="dk-blank-actions">' +
      '<button type="button" class="dk-btn dk-btn-primary" id="dkOpen">Open map</button>' +
      '<button type="button" class="dk-btn" id="dkDemo">Demo</button>' +
      "</div></div></div>";
    host.querySelector("#dkOpen").addEventListener("click", openMap);
    host.querySelector("#dkDemo").addEventListener("click", loadDemo);
  }

  function render(host) {
    var ws = WS.get();
    if (!ws.survey) return renderBlank(host);

    // Old autosaved demos had illegal In-line / DTR tags → 9 gaps.
    if (repairStoredSurveyIfNeeded()) {
      Desk.refresh();
      return;
    }

    var c = counts();
    var selected = selectedId ? findAsset(selectedId) : null;
    var page = document.createElement("div");
    page.className = "dk-page";
    page.innerHTML =
      '<div class="dk-job">' +
      '<div class="dk-map-stage">' +
      '<div class="dk-map-host" id="dkMapHost"></div>' +
      "</div>" +
      '<aside class="dk-side">' +
      '<div class="dk-side-stats">' +
      "<span><b>" +
      c.poles +
      "</b> poles</span>" +
      "<span><b>" +
      c.proposed +
      "</b> proposed</span></div>" +
      (selected
        ? '<div class="dk-side-block" id="dkPolePanel"></div>'
        : '<div class="dk-side-block dk-side-poles">' +
          '<input class="dk-search" id="dkPoleQ" placeholder="Find pole…" value="' +
          esc(poleFilter) +
          '"><div class="dk-pole-list" id="dkPoleList"></div></div>') +
      '<div class="dk-side-block dk-side-est" id="dkEstPanel">' +
      '<div class="dk-side-muted">…</div></div>' +
      "</aside></div>";

    host.appendChild(page);

    var survey = effective();
    if (global.SlmWsMap) {
      global.SlmWsMap.render(page.querySelector("#dkMapHost"), survey, {
        selectedId: selectedId,
        onSelect: function (asset) {
          selectedId = asset.id;
          Desk.refresh();
        },
      });
    }

    var polePanel = page.querySelector("#dkPolePanel");
    if (selected && polePanel) renderPoleEditor(polePanel, selected.id);

    refreshEstimate(true);
    if (typeof ensureAssemblies === "function") {
      ensureAssemblies().catch(function () {});
    }

    var list = page.querySelector("#dkPoleList");
    var qEl = page.querySelector("#dkPoleQ");
    if (list) {
      function drawList() {
        var q = (poleFilter || "").toLowerCase();
        list.innerHTML = "";
        assets().forEach(function (a) {
          var label = "P" + (a.sequence != null ? a.sequence : a.id);
          var sub = [a.structure, a.voltage].filter(Boolean).join(" · ");
          if (q && (label + " " + sub).toLowerCase().indexOf(q) === -1) return;
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className =
            "dk-pole-row" +
            (String(a.id) === String(selectedId) ? " is-selected" : "");
          btn.innerHTML =
            "<strong>" +
            esc(label) +
            "</strong><span>" +
            esc(sub) +
            "</span>";
          btn.addEventListener("click", function () {
            selectedId = a.id;
            Desk.refresh();
          });
          list.appendChild(btn);
        });
      }
      if (qEl) {
        qEl.addEventListener("input", function () {
          poleFilter = qEl.value;
          drawList();
        });
      }
      drawList();
    }
  }

  Desk.register("map", {
    tools: function () {
      var ws = WS.get();
      // Blank Map page owns Import / Open / Demo — keep the rail clean.
      if (!ws.survey) return [];
      return [
        {
          label: "Save",
          kind: "primary",
          onClick: function () {
            Desk.saveJob();
          },
        },
        { label: "Print", onClick: openPrint },
        {
          label: "Close map",
          kind: "quiet",
          onClick: function () {
            if (!window.confirm("Close this map and return to the start page?"))
              return;
            if (global.SlmWsMap) {
              try {
                global.SlmWsMap.destroy();
              } catch (e) {
                /* ignore */
              }
            }
            WS.reset();
            selectedId = null;
            Desk.refresh();
          },
        },
      ];
    },
    render: render,
  });
})(window);
