/**
 * SLM Desktop shell — Map | Structures | Rates.
 * Each desk’s actions live under its own nav block (active only).
 */
(function (global) {
  "use strict";

  var desks = {};
  var activeId = null;
  var WS = global.SlmWorkspace;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg) {
    var el = $("dkToast");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.classList.add("hidden");
    }, 2800);
  }

  function register(id, def) {
    desks[id] = def;
  }

  function normalizeDesk(id) {
    if (id === "job") return "map"; // legacy hash
    if (desks[id]) return id;
    return "map";
  }

  function paintBlockItems(deskId, list) {
    var host = $("dkItems-" + deskId);
    if (!host) return;
    host.innerHTML = "";
    (list || []).forEach(function (a) {
      if (a.kind === "sep") {
        var sep = document.createElement("div");
        sep.className = "dk-block-sep";
        host.appendChild(sep);
        return;
      }
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "dk-block-item" +
        (a.kind === "primary" ? " is-primary" : "") +
        (a.kind === "quiet" ? " is-quiet" : "") +
        (a.kind === "sub" ? " is-sub" : "") +
        (a.active ? " is-on" : "");
      btn.textContent = a.label;
      if (a.disabled) btn.disabled = true;
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (a.onClick) a.onClick();
      });
      host.appendChild(btn);
    });
  }

  function syncBlocks(active) {
    document.querySelectorAll(".dk-block").forEach(function (block) {
      var id = block.getAttribute("data-desk");
      var on = id === active;
      block.classList.toggle("is-active", on);
      var def = desks[id];
      if (!def || !on) {
        paintBlockItems(id, []);
        return;
      }
      paintBlockItems(
        id,
        typeof def.tools === "function" ? def.tools() : def.tools || []
      );
    });
  }

  function go(id) {
    id = normalizeDesk(id);
    if (activeId === "map" && id !== "map" && global.SlmWsMap) {
      try {
        global.SlmWsMap.destroy();
      } catch (e) {
        /* ignore */
      }
    }
    activeId = id;
    syncBlocks(id);
    var main = $("dkMain");
    main.innerHTML = "";
    desks[id].render(main);
    try {
      history.replaceState(null, "", "#" + id);
    } catch (e) {
      /* ignore */
    }
  }

  function refresh() {
    if (activeId) go(activeId);
  }

  function openJob() {
    if (!WS) return Promise.reject();
    return WS.openFromFile()
      .then(function () {
        toast("Opened");
        go("map");
      })
      .catch(function (err) {
        if (err && err.name !== "AbortError") toast("Could not open");
        throw err;
      });
  }

  function saveJob() {
    if (!WS) return Promise.reject(new Error("No workspace"));
    return WS.saveToFile(true)
      .then(function () {
        toast("Saved");
        refresh();
        return true;
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") return false;
        toast((err && err.message) || "Could not save");
        return false;
      });
  }

  function wireShell() {
    document.querySelectorAll(".dk-block-head").forEach(function (btn) {
      btn.addEventListener("click", function () {
        go(btn.getAttribute("data-desk"));
      });
    });
  }

  function start() {
    wireShell();
    window.addEventListener("hashchange", function () {
      var hash = (location.hash || "").replace(/^#/, "");
      go(hash);
    });
    go((location.hash || "").replace(/^#/, "") || "map");
  }

  global.SlmDesk = {
    register: register,
    go: go,
    refresh: refresh,
    toast: toast,
    escapeHtml: escapeHtml,
    start: start,
    openJob: openJob,
    saveJob: saveJob,
    active: function () {
      return activeId;
    },
  };
})(window);
