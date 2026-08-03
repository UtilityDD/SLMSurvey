/**
 * Presets — named mobile option-flows bound to a canonical assembly match key.
 */
(function (global) {
  "use strict";

  var App = global.SlmWsApp;
  var WS = global.SlmWorkspace;
  var Cat = global.SlmCatalog;
  var esc = App.escapeHtml;

  var PACK_FORMAT = "slm.preset.pack";
  var PACK_VERSION = 1;

  var DEFAULT_STEPS = [
    { key: "span", label: "Typical span (m)", type: "number", options: [] },
    {
      key: "stay",
      label: "Stay / strut",
      type: "choice",
      options: ["None", "Single stay", "Double stay"],
    },
  ];

  function openPresetEditor(preset) {
    if (!Cat.isLoaded()) {
      Cat.load()
        .then(function () {
          openPresetEditor(preset);
        })
        .catch(function (err) {
          App.toast(err.message || String(err));
        });
      return;
    }

    var draft = preset
      ? JSON.parse(JSON.stringify(preset))
      : {
          id: WS.uid("pre"),
          name: "",
          assemblyId: "",
          matchKey: "",
          steps: JSON.parse(JSON.stringify(DEFAULT_STEPS)),
          notes: "",
        };

    App.openDrawer({
      title: preset ? "Edit preset" : "New preset",
      subtitle: "Fast mobile capture. Must bind to a matchable assembly.",
      render: function (body) {
        body.innerHTML =
          '<label class="ws-field"><span>Display name *</span><input class="ws-input" id="pName" value="' +
          esc(draft.name) +
          '" placeholder="e.g. 11kV Angle — our package"></label>' +
          '<label class="ws-field"><span>Bound assembly *</span>' +
          '<div class="ws-search" style="box-shadow:none;margin-top:4px"><input id="pAsmQ" placeholder="Search assembly to bind…" value="' +
          esc(draft.assemblyId ? Cat.title(Cat.getById(draft.assemblyId) || WS.assemblyById(WS.get(), draft.assemblyId) || {}) : "") +
          '"></div>' +
          '<div id="pAsmPick" class="ws-rows" style="max-height:180px;overflow:auto;margin-top:6px;border:1px solid var(--line);border-radius:8px"></div>' +
          '<p class="ws-note" id="pBindMeta" style="margin-top:6px"></p></label>' +
          '<div class="ws-section-label">Option flow (mobile)</div>' +
          '<div class="ws-mini-rows" id="pSteps"></div>' +
          '<button type="button" class="ws-btn ws-btn-sm" id="pAddStep" style="margin-top:8px">+ Step</button>' +
          '<label class="ws-field" style="margin-top:14px"><span>Notes</span><input class="ws-input" id="pNotes" value="' +
          esc(draft.notes || "") +
          '"></label>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">' +
          (preset
            ? '<button type="button" class="ws-btn ws-btn-danger" id="pDel" style="margin-right:auto">Delete</button>'
            : "") +
          '<button type="button" class="ws-btn" id="pCancel">Cancel</button>' +
          '<button type="button" class="ws-btn ws-btn-primary" id="pSave">Save preset</button></div>';

        function syncBindMeta() {
          var meta = body.querySelector("#pBindMeta");
          if (!draft.assemblyId) {
            meta.textContent = "Pick an assembly — the match key is stored with the preset.";
            return;
          }
          var kit =
            Cat.getById(draft.assemblyId) ||
            WS.assemblyById(WS.get(), draft.assemblyId);
          if (!draft.capture && kit) draft.capture = Cat.captureFromKit(kit);
          var cap = draft.capture || {};
          var fields = [
            cap.voltage,
            cap.structure,
            cap.kitLocation,
            cap.kitArrangement,
            cap.kitExtension,
            cap.conductor,
            cap.dtrMount ? "DTR " + cap.dtrMount : "",
            cap.dtCapacityKva ? cap.dtCapacityKva + " kVA" : "",
          ]
            .filter(Boolean)
            .join(" · ");
          meta.innerHTML =
            "Match key: <code>" +
            esc(draft.matchKey || (kit ? Cat.matchKey(kit) : "—")) +
            "</code>" +
            (fields ? "<br>Phone pre-fills: " + esc(fields) : "");
        }

        function drawSteps() {
          var host = body.querySelector("#pSteps");
          host.innerHTML = "";
          (draft.steps || []).forEach(function (step, idx) {
            var row = document.createElement("div");
            row.className = "ws-mini-row";
            row.style.flexWrap = "wrap";
            row.innerHTML =
              '<input class="ws-input" style="flex:1;min-width:120px" data-slabel value="' +
              esc(step.label || "") +
              '" placeholder="Question">' +
              '<select class="ws-select" style="width:110px" data-stype>' +
              '<option value="choice"' +
              (step.type === "choice" ? " selected" : "") +
              ">Choice</option>" +
              '<option value="number"' +
              (step.type === "number" ? " selected" : "") +
              ">Number</option>" +
              '<option value="text"' +
              (step.type === "text" ? " selected" : "") +
              ">Text</option></select>" +
              '<input class="ws-input" style="flex:1.2;min-width:140px" data-sopts value="' +
              esc((step.options || []).join(", ")) +
              '" placeholder="Options (comma-separated)"' +
              (step.type === "choice" ? "" : " disabled") +
              ">" +
              '<button type="button" class="ws-icon-btn" data-sdel>×</button>';
            row.querySelector("[data-slabel]").addEventListener("change", function (e) {
              draft.steps[idx].label = e.target.value;
            });
            row.querySelector("[data-stype]").addEventListener("change", function (e) {
              draft.steps[idx].type = e.target.value;
              drawSteps();
            });
            row.querySelector("[data-sopts]").addEventListener("change", function (e) {
              draft.steps[idx].options = e.target.value
                .split(",")
                .map(function (s) {
                  return s.trim();
                })
                .filter(Boolean);
            });
            row.querySelector("[data-sdel]").addEventListener("click", function () {
              draft.steps.splice(idx, 1);
              drawSteps();
            });
            host.appendChild(row);
          });
          if (!(draft.steps || []).length) {
            host.innerHTML =
              '<div class="ws-empty" style="padding:12px">No steps — mobile will just pick the bound assembly.</div>';
          }
        }

        function drawAsmPick() {
          var q = body.querySelector("#pAsmQ").value.trim();
          var host = body.querySelector("#pAsmPick");
          host.innerHTML = "";
          var job = WS.get().assemblies || [];
          var kits =
            q.length >= 2
              ? Cat.search(q, { limit: 20 })
              : job.slice(0, 20);
          if (!kits.length && q.length < 2) {
            host.innerHTML =
              '<div class="ws-empty" style="padding:12px">Type to search the catalog, or add assemblies to the job first.</div>';
            return;
          }
          kits.forEach(function (kit) {
            var row = document.createElement("div");
            row.className = "ws-row";
            var selected = draft.assemblyId === kit.id;
            row.innerHTML =
              '<div class="ws-row-main"><div class="ws-row-title">' +
              esc(Cat.title(kit)) +
              (selected ? ' <span class="ws-pill ws-pill-ok">bound</span>' : "") +
              '</div><div class="ws-row-sub">' +
              esc(Cat.subtitle(kit)) +
              "</div></div>";
            row.style.cursor = "pointer";
            row.addEventListener("click", function () {
              draft.assemblyId = kit.id;
              draft.matchKey = Cat.matchKey(kit);
              draft.capture = Cat.captureFromKit(kit);
              body.querySelector("#pAsmQ").value = Cat.title(kit);
              syncBindMeta();
              drawAsmPick();
            });
            host.appendChild(row);
          });
        }

        body.querySelector("#pAsmQ").addEventListener("input", drawAsmPick);
        body.querySelector("#pAddStep").addEventListener("click", function () {
          draft.steps = draft.steps || [];
          draft.steps.push({
            key: "step" + (draft.steps.length + 1),
            label: "",
            type: "choice",
            options: [],
          });
          drawSteps();
        });
        body.querySelector("#pCancel").addEventListener("click", App.closeDrawer);
        body.querySelector("#pSave").addEventListener("click", function () {
          draft.name = body.querySelector("#pName").value.trim();
          draft.notes = body.querySelector("#pNotes").value.trim();
          if (!draft.name) return App.toast("Name is required");
          if (!draft.assemblyId || !draft.matchKey) {
            return App.toast("Bind a matchable assembly");
          }
          var kit =
            Cat.getById(draft.assemblyId) ||
            WS.assemblyById(WS.get(), draft.assemblyId);
          if (kit) {
            draft.matchKey = Cat.matchKey(kit);
            draft.capture = Cat.captureFromKit(kit);
          }
          if (!draft.capture) return App.toast("Could not build phone capture fields");
          WS.update(function (ws) {
            var idx = ws.presets.findIndex(function (p) {
              return p.id === draft.id;
            });
            if (idx >= 0) ws.presets[idx] = draft;
            else ws.presets.push(draft);
          }, "presets");
          App.closeDrawer();
          App.refresh();
          App.toast("Preset saved");
        });
        if (preset) {
          body.querySelector("#pDel").addEventListener("click", async function () {
            var ok = await global.SlmDialog.confirm({
              title: "Delete preset?",
              message: draft.name,
              okLabel: "Delete",
              danger: true,
            });
            if (!ok) return;
            WS.update(function (ws) {
              ws.presets = ws.presets.filter(function (p) {
                return p.id !== draft.id;
              });
            }, "presets");
            App.closeDrawer();
            App.refresh();
          });
        }

        syncBindMeta();
        drawSteps();
        drawAsmPick();
      },
    });
  }

  /* ---------- transfer to / from the phone ---------- */

  function packFromWorkspace(ws) {
    return {
      format: PACK_FORMAT,
      version: PACK_VERSION,
      exportedAt: new Date().toISOString(),
      source: { app: "slm-workspace", job: ws.name || "" },
      presets: (ws.presets || []).map(function (p) {
        var kit = Cat.getById(p.assemblyId) || WS.assemblyById(ws, p.assemblyId);
        return {
          id: p.id,
          name: p.name,
          notes: p.notes || "",
          assemblyId: p.assemblyId,
          matchKey: p.matchKey || (kit ? Cat.matchKey(kit) : ""),
          capture: p.capture || (kit ? Cat.captureFromKit(kit) : null),
          steps: (p.steps || []).map(function (s, i) {
            return {
              key: s.key || "step" + (i + 1),
              label: s.label || "",
              type: s.type || "choice",
              options: s.options || [],
            };
          }),
        };
      }),
    };
  }

  function exportPack() {
    var ws = WS.get();
    if (!(ws.presets || []).length) return App.toast("No presets to export");
    if (Cat.isLoaded()) {
      WS.update(function (w) {
        w.presets.forEach(function (p) {
          var kit = Cat.getById(p.assemblyId) || WS.assemblyById(w, p.assemblyId);
          if (!kit) return;
          p.matchKey = Cat.matchKey(kit);
          p.capture = Cat.captureFromKit(kit);
        });
      }, "presets");
    }
    var pack = packFromWorkspace(WS.get());
    var unbound = pack.presets.filter(function (p) {
      return !p.matchKey || !p.capture;
    });
    if (unbound.length) {
      return App.toast(
        unbound.length + " preset(s) are not bound to a matchable assembly — fix before export"
      );
    }
    window.SlmSeal.exportPresetPack(pack, (ws.name || "presets").replace(/\s+/g, "-").toLowerCase())
      .then(function (name) {
        App.toast("Exported " + name);
      })
      .catch(function (err) {
        App.toast(err.message || String(err));
      });
  }

  function exportPackPlain() {
    var ws = WS.get();
    if (!(ws.presets || []).length) return App.toast("No presets to export");
    var pack = packFromWorkspace(ws);
    window.SlmSeal.exportPresetPlain(pack, (ws.name || "presets").replace(/\s+/g, "-").toLowerCase())
      .then(function (name) {
        App.toast("Exported " + name);
      })
      .catch(function (err) {
        App.toast(err.message || String(err));
      });
  }

  function importPack() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".slmpreset,.json,application/json,application/octet-stream";
    input.addEventListener("change", async function () {
      var file = input.files && input.files[0];
      if (!file) return;
      try {
        var opened = await window.SlmSeal.openTransferText(
          await file.text(),
          window.SlmSeal.KIND_PRESET
        );
        var pack = opened.payload;
        if (pack.format !== PACK_FORMAT) throw new Error("Not a preset pack file");
        if (Number(pack.version) > PACK_VERSION) {
          throw new Error("Pack was made by a newer version");
        }
        var incoming = (pack.presets || []).filter(function (p) {
          return p && p.name && p.matchKey;
        });
        if (!incoming.length) throw new Error("Pack has no usable presets");
        WS.update(function (ws) {
          incoming.forEach(function (p) {
            var next = {
              id: p.id || WS.uid("pre"),
              name: p.name,
              notes: p.notes || "",
              assemblyId: p.assemblyId || "",
              matchKey: p.matchKey,
              capture: p.capture || null,
              steps: p.steps || [],
            };
            var idx = ws.presets.findIndex(function (x) {
              return x.id === next.id || x.name === next.name;
            });
            if (idx >= 0) ws.presets[idx] = next;
            else ws.presets.push(next);
          });
        }, "presets");
        App.refresh();
        var who = opened.license && opened.license.customerName;
        App.toast(
          "Imported " +
            incoming.length +
            " presets" +
            (who ? " · " + who : "")
        );
      } catch (err) {
        App.toast("Import failed: " + (err.message || err));
      }
    });
    input.click();
  }

  function render(host, ws) {
    var stack = document.createElement("div");
    stack.className = "ws-stack";
    if (!(ws.presets || []).length) {
      stack.innerHTML =
        '<div class="ws-blank"><h3>No mobile presets yet</h3>' +
        "<p>Create a named shortcut with a short option-flow, bound to a real assembly match key. The phone stays fast; desktop matching stays honest.</p>" +
        '<div class="ws-blank-actions"><button type="button" class="ws-btn ws-btn-primary" id="pNew">New preset</button>' +
        '<button type="button" class="ws-btn" id="pImp">Import pack</button></div></div>';
      host.appendChild(stack);
      stack.querySelector("#pNew").addEventListener("click", function () {
        openPresetEditor(null);
      });
      stack.querySelector("#pImp").addEventListener("click", importPack);
      return;
    }

    stack.innerHTML =
      '<div class="ws-card"><div class="ws-card-head"><div><h2>Presets for mobile</h2>' +
      "<p>" +
      ws.presets.length +
      " shortcut(s) · each bound to a canonical match</p></div></div>" +
      '<div class="ws-rows" id="pRows"></div></div>';
    host.appendChild(stack);
    var rows = stack.querySelector("#pRows");
    ws.presets.forEach(function (p) {
      var kit =
        Cat.getById(p.assemblyId) || WS.assemblyById(ws, p.assemblyId);
      var row = document.createElement("div");
      row.className = "ws-row";
      row.innerHTML =
        '<div class="ws-row-main"><div class="ws-row-title">' +
        esc(p.name) +
        ' <span class="ws-pill">' +
        (p.steps || []).length +
        " steps</span>" +
        (p.matchKey && p.capture
          ? ' <span class="ws-pill ws-pill-ok">ready for phone</span>'
          : ' <span class="ws-pill ws-pill-warn">rebind needed</span>') +
        "</div>" +
        '<div class="ws-row-sub">' +
        esc(kit ? Cat.title(kit) : p.assemblyId) +
        " · match " +
        esc(p.matchKey || "—") +
        "</div></div>";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ws-btn ws-btn-sm";
      btn.textContent = "Edit";
      btn.addEventListener("click", function () {
        openPresetEditor(p);
      });
      var actions = document.createElement("div");
      actions.className = "ws-row-actions";
      actions.appendChild(btn);
      row.appendChild(actions);
      rows.appendChild(row);
    });
  }

  App.register("presets", {
    label: "Presets",
    title: "Presets",
    hint: "Mobile option-flows for fast field work. Every preset must bind to a matchable assembly.",
    badge: function (ws) {
      return (ws.presets || []).length || "";
    },
    actions: function (ws) {
      var list = [
        {
          label: "New preset",
          kind: "primary",
          onClick: function () {
            openPresetEditor(null);
          },
        },
      ];
      if ((ws.presets || []).length) {
        list.push({ label: "Export sealed", onClick: exportPack });
        if (window.SlmSeal && window.SlmSeal.isAdmin()) {
          list.push({ label: "Export plain JSON", kind: "quiet", onClick: exportPackPlain });
        }
      }
      list.push({ label: "Import pack", kind: "quiet", onClick: importPack });
      return list;
    },
    render: render,
  });
})(window);
