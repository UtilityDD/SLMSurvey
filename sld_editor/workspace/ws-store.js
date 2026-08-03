/**
 * Workspace store — one local job holds survey, assemblies, rates, contract and presets.
 * Autosaves to localStorage; can be opened from / saved to a .slmws.json file on disk.
 */
(function (global) {
  "use strict";

  var AUTOSAVE_KEY = "slm_workspace_v2";
  var FILE_EXT = ".slmws.json";
  var listeners = [];
  var fileHandle = null;
  var saveTimer = null;

  function uid(prefix) {
    return (
      (prefix || "id") +
      "_" +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 7)
    );
  }

  function blank(name) {
    var now = new Date().toISOString();
    return {
      version: 1,
      name: name || "Untitled job",
      createdAt: now,
      updatedAt: now,
      survey: null,
      poleOverrides: {},
      assemblies: [],
      counts: {},
      rates: { materials: [], labour: [] },
      contract: { name: "", items: [] },
      billsAs: {},
      presets: [],
      extras: null,
    };
  }

  function normalise(raw) {
    var ws = blank();
    if (!raw || typeof raw !== "object") return ws;
    ws.name = raw.name || ws.name;
    ws.createdAt = raw.createdAt || ws.createdAt;
    ws.updatedAt = raw.updatedAt || ws.updatedAt;
    ws.survey = raw.survey || null;
    ws.poleOverrides = raw.poleOverrides || {};
    ws.assemblies = Array.isArray(raw.assemblies) ? raw.assemblies : [];
    ws.counts = raw.counts || {};
    ws.rates = {
      materials: Array.isArray(raw.rates && raw.rates.materials)
        ? raw.rates.materials
        : [],
      labour: Array.isArray(raw.rates && raw.rates.labour) ? raw.rates.labour : [],
    };
    ws.contract = {
      name: (raw.contract && raw.contract.name) || "",
      items: Array.isArray(raw.contract && raw.contract.items)
        ? raw.contract.items
        : [],
    };
    ws.billsAs = raw.billsAs || {};
    ws.presets = Array.isArray(raw.presets) ? raw.presets : [];
    ws.extras = raw.extras || null;
    return ws;
  }

  var current = blank();

  function get() {
    return current;
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (f) {
        return f !== fn;
      });
    };
  }

  function emit(reason) {
    listeners.forEach(function (fn) {
      try {
        fn(current, reason);
      } catch (err) {
        console.error(err);
      }
    });
  }

  /** Mutate the workspace through this so autosave + re-render always happen. */
  function update(mutator, reason) {
    if (typeof mutator === "function") mutator(current);
    current.updatedAt = new Date().toISOString();
    scheduleAutosave();
    emit(reason || "update");
    return current;
  }

  function scheduleAutosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autosave, 250);
  }

  function autosave() {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(current));
    } catch (err) {
      console.warn("Autosave failed", err);
    }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) current = normalise(JSON.parse(raw));
    } catch (err) {
      console.warn("Restore failed", err);
    }
    emit("restore");
    return current;
  }

  function replace(raw, reason) {
    current = normalise(raw);
    autosave();
    emit(reason || "replace");
    return current;
  }

  function reset(name) {
    current = blank(name);
    fileHandle = null;
    autosave();
    emit("reset");
    return current;
  }

  function fileName() {
    var safe = String(current.name || "workspace")
      .replace(/[^\w\-. ]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase();
    return (safe || "workspace") + FILE_EXT;
  }

  function supportsFileSystem() {
    return typeof global.showSaveFilePicker === "function";
  }

  var pickerTypes = [
    {
      description: "SLM workspace",
      accept: { "application/json": [".json"] },
    },
  ];

  async function saveToFile(forcePicker) {
    var text = JSON.stringify(current, null, 2);
    if (supportsFileSystem()) {
      if (!fileHandle || forcePicker) {
        fileHandle = await global.showSaveFilePicker({
          suggestedName: fileName(),
          types: pickerTypes,
        });
      }
      var writable = await fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      return fileHandle.name;
    }
    var blob = new Blob([text], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    a.click();
    URL.revokeObjectURL(a.href);
    return a.download;
  }

  async function openFromFile() {
    if (typeof global.showOpenFilePicker === "function") {
      var picked = await global.showOpenFilePicker({
        types: pickerTypes,
        multiple: false,
      });
      fileHandle = picked[0];
      var file = await fileHandle.getFile();
      replace(JSON.parse(await file.text()), "open");
      return file.name;
    }
    return new Promise(function (resolve, reject) {
      var input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.addEventListener("change", async function () {
        var f = input.files && input.files[0];
        if (!f) return resolve(null);
        try {
          replace(JSON.parse(await f.text()), "open");
          resolve(f.name);
        } catch (err) {
          reject(err);
        }
      });
      input.click();
    });
  }

  /* ---------- derived helpers ---------- */

  /** Survey with desktop pole overrides applied — this is what matching should use. */
  function effectiveSurvey(ws) {
    var w = ws || current;
    if (!w.survey) return null;
    var overrides = w.poleOverrides || {};
    if (!Object.keys(overrides).length) return w.survey;
    return Object.assign({}, w.survey, {
      assets: (w.survey.assets || []).map(function (a) {
        var ov = overrides[a.id];
        if (!ov) return a;
        // Voltage always stays as surveyed (phone / field).
        var safe = Object.assign({}, ov);
        delete safe.voltage;
        return Object.assign({}, a, safe);
      }),
    });
  }

  function assemblyById(ws, id) {
    return ((ws || current).assemblies || []).find(function (k) {
      return k.id === id;
    });
  }

  function hasAssembly(ws, id) {
    return !!assemblyById(ws, id);
  }

  /** Ratebook shape expected by SlmEstimateMatch. */
  function ratebook(ws) {
    var w = ws || current;
    return {
      materials: w.rates.materials || [],
      labour: w.rates.labour || [],
    };
  }

  /** Contract items as a schedule book; internal id doubles as the match code. */
  function scheduleBook(ws) {
    var w = ws || current;
    return {
      id: "ws_contract",
      name: w.contract.name || "Contract schedule",
      items: (w.contract.items || []).map(function (it) {
        return {
          code: it.id,
          description: it.description || it.code || it.id,
          unit: it.unit || "NOS",
          rate: Number(it.rate) || 0,
          type: it.type === "labour" ? "labour" : "material",
        };
      }),
    };
  }

  /** billsAs → bridge mappings understood by buildContractReportFromHits. */
  function bridge(ws) {
    var w = ws || current;
    var mappings = {};
    Object.keys(w.billsAs || {}).forEach(function (assemblyId) {
      var links = w.billsAs[assemblyId] || [];
      if (!links.length) return;
      mappings[assemblyId] = links.map(function (l) {
        var item = (w.contract.items || []).find(function (i) {
          return i.id === l.itemId;
        });
        return {
          code: l.itemId,
          type: (item && item.type) === "labour" ? "labour" : "material",
          qtyPerUnit: Number(l.qtyPerUnit) > 0 ? Number(l.qtyPerUnit) : 1,
        };
      });
    });
    return { id: "ws_bridge", name: w.contract.name || "This job", mappings: mappings };
  }

  global.SlmWorkspace = {
    uid: uid,
    blank: blank,
    get: get,
    update: update,
    subscribe: subscribe,
    restore: restore,
    replace: replace,
    reset: reset,
    saveToFile: saveToFile,
    openFromFile: openFromFile,
    supportsFileSystem: supportsFileSystem,
    fileName: fileName,
    effectiveSurvey: effectiveSurvey,
    assemblyById: assemblyById,
    hasAssembly: hasAssembly,
    ratebook: ratebook,
    scheduleBook: scheduleBook,
    bridge: bridge,
  };
})(window);
