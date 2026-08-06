/**
 * Shared clean dialogs for SLM desktop (replaces alert / confirm / prompt).
 * window.SlmDialog.alert | confirm | prompt | choice → Promise
 *
 * choice resolves: "primary" | "secondary" | null (cancel / dismiss)
 */
(function (global) {
  "use strict";

  var ROOT_ID = "slmDialogRoot";
  var resolveFn = null;

  function ensureDom() {
    var root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "slm-dialog-root hidden";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.innerHTML =
      '<div class="slm-dialog-card">' +
      '  <h3 class="slm-dialog-title" id="slmDialogTitle"></h3>' +
      '  <p class="slm-dialog-body" id="slmDialogBody"></p>' +
      '  <div class="slm-dialog-field hidden" id="slmDialogFieldWrap">' +
      '    <label class="slm-dialog-label" id="slmDialogLabel" for="slmDialogInput"></label>' +
      '    <input type="text" class="slm-dialog-input" id="slmDialogInput" autocomplete="off">' +
      "  </div>" +
      '  <div class="slm-dialog-actions">' +
      '    <button type="button" class="slm-dialog-btn slm-dialog-btn-ghost" id="slmDialogCancel">Cancel</button>' +
      '    <button type="button" class="slm-dialog-btn slm-dialog-btn-ghost hidden" id="slmDialogSecondary">Don\'t save</button>' +
      '    <button type="button" class="slm-dialog-btn slm-dialog-btn-primary" id="slmDialogOk">OK</button>' +
      "  </div>" +
      "</div>";
    document.body.appendChild(root);

    root.addEventListener("click", function (e) {
      if (e.target === root) finish(null);
    });
    document.getElementById("slmDialogCancel").addEventListener("click", function () {
      finish(null);
    });
    document.getElementById("slmDialogSecondary").addEventListener("click", function () {
      finish("secondary");
    });
    document.getElementById("slmDialogOk").addEventListener("click", function () {
      finish("primary");
    });
    document.getElementById("slmDialogInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        finish("primary");
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && root && !root.classList.contains("hidden")) {
        e.preventDefault();
        finish(null);
      }
    });
    return root;
  }

  function finish(result) {
    if (!resolveFn) return;
    var root = document.getElementById(ROOT_ID);
    var mode = root && root.getAttribute("data-mode");
    var input = document.getElementById("slmDialogInput");
    var done = resolveFn;
    resolveFn = null;
    if (root) root.classList.add("hidden");
    if (mode === "prompt") {
      done(result === "primary" ? String(input.value || "") : null);
    } else if (mode === "confirm") {
      done(result === "primary");
    } else if (mode === "choice") {
      done(result === "primary" || result === "secondary" ? result : null);
    } else {
      done();
    }
  }

  function openDialog(opts) {
    opts = opts || {};
    var root = ensureDom();
    if (resolveFn) finish(null);

    return new Promise(function (resolve) {
      resolveFn = resolve;
      root.setAttribute("data-mode", opts.mode || "alert");
      root.classList.toggle("slm-dialog-danger", !!opts.danger);

      document.getElementById("slmDialogTitle").textContent = opts.title || "";
      document.getElementById("slmDialogBody").textContent = opts.message || "";

      var field = document.getElementById("slmDialogFieldWrap");
      var input = document.getElementById("slmDialogInput");
      var label = document.getElementById("slmDialogLabel");
      var cancel = document.getElementById("slmDialogCancel");
      var secondary = document.getElementById("slmDialogSecondary");
      var ok = document.getElementById("slmDialogOk");

      var isPrompt = opts.mode === "prompt";
      var isAlert = opts.mode === "alert";
      var isChoice = opts.mode === "choice";
      field.classList.toggle("hidden", !isPrompt);
      cancel.classList.toggle("hidden", isAlert);
      secondary.classList.toggle("hidden", !isChoice);
      cancel.textContent = opts.cancelLabel || "Cancel";
      secondary.textContent = opts.secondaryLabel || "Don't save";
      ok.textContent =
        opts.okLabel ||
        (isAlert ? "OK" : isPrompt ? "Continue" : isChoice ? "Save" : "Confirm");
      ok.classList.toggle("slm-dialog-btn-danger", !!opts.danger);

      if (isPrompt) {
        label.textContent = opts.inputLabel || "";
        label.classList.toggle("hidden", !opts.inputLabel);
        input.value = opts.defaultValue != null ? String(opts.defaultValue) : "";
        input.placeholder = opts.placeholder || "";
        input.type = opts.inputType || "text";
      }

      root.classList.remove("hidden");
      setTimeout(function () {
        if (isPrompt) input.focus();
        else ok.focus();
      }, 20);
    });
  }

  global.SlmDialog = {
    alert: function (opts) {
      if (typeof opts === "string") opts = { message: opts };
      return openDialog({
        mode: "alert",
        title: (opts && opts.title) || "Notice",
        message: (opts && opts.message) || "",
        okLabel: (opts && opts.okLabel) || "OK",
      });
    },
    confirm: function (opts) {
      if (typeof opts === "string") opts = { message: opts };
      return openDialog({
        mode: "confirm",
        title: (opts && opts.title) || "Please confirm",
        message: (opts && opts.message) || "",
        okLabel: (opts && opts.okLabel) || "Confirm",
        cancelLabel: (opts && opts.cancelLabel) || "Cancel",
        danger: !!(opts && opts.danger),
      });
    },
    /** Three-way: primary | secondary | null (cancel). */
    choice: function (opts) {
      if (typeof opts === "string") opts = { message: opts };
      return openDialog({
        mode: "choice",
        title: (opts && opts.title) || "Please choose",
        message: (opts && opts.message) || "",
        okLabel: (opts && opts.okLabel) || "Save",
        secondaryLabel: (opts && opts.secondaryLabel) || "Don't save",
        cancelLabel: (opts && opts.cancelLabel) || "Cancel",
        danger: !!(opts && opts.danger),
      });
    },
    prompt: function (opts) {
      if (typeof opts === "string") opts = { message: opts };
      return openDialog({
        mode: "prompt",
        title: (opts && opts.title) || "Enter value",
        message: (opts && opts.message) || "",
        inputLabel: (opts && opts.inputLabel) || "",
        defaultValue: opts && opts.defaultValue,
        placeholder: (opts && opts.placeholder) || "",
        inputType: (opts && opts.inputType) || "text",
        okLabel: (opts && opts.okLabel) || "Continue",
        cancelLabel: (opts && opts.cancelLabel) || "Cancel",
      });
    },
  };
})(window);
