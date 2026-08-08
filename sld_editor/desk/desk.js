/**
 * SLM Desktop shell — Map | Structures | Rates | Licenses (admin).
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

  /**
   * APK download URL for the desk rail button.
   * - Non-Drive URLs (GitHub Releases, Supabase Storage, CDN) are used as-is (true direct download).
   * - Drive share/view links open Drive’s export page where the user must click
   *   “Download anyway” — Google always shows that for large executables; silent
   *   confirm=t bypass does not work for APKs over the virus-scan size limit.
   */
  function apkDownloadUrl(raw) {
    var s = String(raw || "").trim();
    if (!s) return { href: "", kind: "none" };
    var isDrive = /drive\.google\.com|drive\.usercontent\.google\.com/i.test(s);
    if (!isDrive) return { href: s, kind: "direct" };

    var id = "";
    var m =
      s.match(/\/file\/d\/([^/]+)/) ||
      s.match(/[?&]id=([^&]+)/) ||
      s.match(/\/d\/([^/]+)/);
    if (m) id = decodeURIComponent(m[1]);
    else if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) id = s;
    if (!id) return { href: s, kind: "drive" };
    return {
      href:
        "https://drive.google.com/uc?export=download&id=" +
        encodeURIComponent(id),
      kind: "drive",
    };
  }

  function wireApkDownload() {
    var link = $("dkApkDownload");
    if (!link) return;
    var cfg = global.SLM_LICENSE_CONFIG || {};
    var raw = cfg.PHONE_APK_URL || cfg.PHONE_APK_DRIVE_URL || "";
    var info = apkDownloadUrl(raw);
    var L = global.SlmLicense;
    var allowed =
      !L || !L.enabled || !!(L.canApprove && L.canApprove());
    if (!info.href || !allowed) {
      link.classList.add("hidden");
      link.removeAttribute("href");
      link.onclick = null;
      return;
    }
    link.href = info.href;
    link.target = "_blank";
    link.rel = "noopener";
    if (info.kind === "direct") {
      link.setAttribute("download", "SLMSurvey.apk");
      link.title = "Download phone APK";
      link.textContent = "Download phone APK";
      link.onclick = null;
    } else {
      link.removeAttribute("download");
      link.title =
        "Google Drive blocks silent APK download — click Download anyway on the next page";
      link.textContent = "Download phone APK";
      link.onclick = function () {
        toast("On the next page, click “Download anyway”");
      };
    }
    link.classList.remove("hidden");
  }

  function syncAdminNav() {
    var block = $("dkBlockLicenses");
    if (!block) return;
    var Lic = global.SlmDeskLicenses;
    var show = Lic && Lic.canAdmin ? Lic.canAdmin() : false;
    block.classList.toggle("hidden", !show);
    if (!show && activeId === "licenses") go("map");
  }

  function refreshSessionCard() {
    var L = global.SlmLicense;
    if (L && typeof L.refreshBadge === "function") L.refreshBadge();
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
    wireApkDownload();
    syncAdminNav();
    refreshSessionCard();
    window.addEventListener("slm-license-changed", function () {
      wireApkDownload();
      syncAdminNav();
      refreshSessionCard();
    });
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
