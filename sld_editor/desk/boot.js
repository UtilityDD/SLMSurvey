/**
 * Boot the new 3-desk shell after license check.
 */
(function () {
  "use strict";

  async function boot() {
    if (window.SlmLicense && window.SlmLicense.ensureLicensed) {
      var ok = await window.SlmLicense.ensureLicensed();
      if (!ok) return;
    }
    if (window.SlmWorkspace && window.SlmWorkspace.restore) {
      try {
        window.SlmWorkspace.restore();
      } catch (e) {
        /* ignore */
      }
    }
    if (window.SlmCatalog && window.SlmCatalog.load) {
      window.SlmCatalog.load().catch(function () {});
    }
    window.SlmDesk.start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
