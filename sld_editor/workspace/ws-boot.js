/**
 * Boot the workspace shell once all views have registered.
 */
(function () {
  "use strict";

  function boot() {
    var App = window.SlmWsApp;
    var Cat = window.SlmCatalog;

    // Preload catalog in the background (large JSON) so Survey suggestions are ready.
    Cat.load().catch(function (err) {
      console.warn("Catalog preload failed", err);
    });

    // CAD → workspace handoff
    if (window.SlmWsSurvey && window.SlmWsSurvey.takeSessionHandoff) {
      window.SlmWsSurvey.takeSessionHandoff();
    }

    App.start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
