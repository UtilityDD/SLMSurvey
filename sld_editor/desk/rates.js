/**
 * Rates desk — materials, labour, turnkey schedules.
 */
(function (global) {
  "use strict";

  var Desk = global.SlmDesk;
  var esc = function (s) {
    return Desk.escapeHtml(s);
  };

  var RATEBOOK_URL = "../estimate/ratebook.json";
  var state = {
    tab: "materials", // materials | labour | schedules | rules
    ratebook: null,
    schedules: null,
    q: "",
  };

  function loadRatebook() {
    if (state.ratebook) return Promise.resolve(state.ratebook);
    return fetch(RATEBOOK_URL)
      .then(function (r) {
        return r.json();
      })
      .then(function (rb) {
        state.ratebook = rb;
        return rb;
      });
  }

  function loadSchedules() {
    if (state.schedules) return Promise.resolve(state.schedules);
    var Books = global.SlmScheduleBooks;
    var local = Books && Books.listBooks ? Books.listBooks() : [];
    return fetch("../estimate/demo_contract_schedule.json")
      .then(function (r) {
        return r.json();
      })
      .then(function (one) {
        var list = local.slice();
        if (one) list.unshift(one);
        state.schedules = list;
        return state.schedules;
      })
      .catch(function () {
        state.schedules = local;
        return state.schedules;
      });
  }

  function filterRows(rows) {
    var q = state.q.toLowerCase();
    if (!q) return rows;
    return rows.filter(function (r) {
      return (
        (r.code || "") +
        " " +
        (r.description || r.name || "")
      )
        .toLowerCase()
        .indexOf(q) !== -1;
    });
  }

  function renderTable(rows, rateKey) {
    var list = filterRows(rows).slice(0, 400);
    return (
      '<div class="dk-filters"><input class="dk-search" id="dkRateQ" placeholder="Search…" value="' +
      esc(state.q) +
      '"><span style="color:var(--dk-muted);font-size:0.85rem">' +
      list.length +
      (rows.length > list.length ? "+" : "") +
      " items</span></div>" +
      '<div class="dk-table-wrap" style="max-height:calc(100vh - 220px)"><table class="dk-table"><thead><tr><th>Code</th><th>Description</th><th class="dk-num">Rate</th></tr></thead><tbody>' +
      list
        .map(function (r) {
          return (
            "<tr><td>" +
            esc(r.code || "—") +
            "</td><td>" +
            esc(r.description || r.name || "") +
            '</td><td class="dk-num">' +
            esc(
              r[rateKey] != null
                ? r[rateKey]
                : r.rate != null
                  ? r.rate
                  : "—"
            ) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>"
    );
  }

  function renderSchedules(list) {
    if (!list.length) {
      return "<p style=\"color:var(--dk-muted)\">No schedule books found.</p>";
    }
    return (
      '<div class="dk-sched-list">' +
      list
        .map(function (s) {
          var n = (s.items || s.mappings || []).length;
          return (
            '<div class="dk-sched-item"><div><strong>' +
            esc(s.name || s.id || "Schedule") +
            "</strong><br><span>" +
            esc(s.id || "") +
            '</span></div><span>' +
            n +
            " items</span></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function paint(page) {
    if (state.tab === "rules") {
      var Rules = global.SlmDeskRules;
      if (Rules && Rules.render) {
        page.innerHTML = "";
        Rules.render(page);
      } else {
        page.innerHTML =
          '<div class="dk-blank"><h2>Phone rules unavailable</h2></div>';
      }
      return;
    }

    var rb = state.ratebook || { materials: [], labour: [] };
    var titles = {
      materials: ["Materials", "Item rates from the rate book."],
      labour: ["Labour", "Labour rates from the rate book."],
      schedules: ["Turnkey", "Contract schedule books."],
    };
    var head = titles[state.tab] || titles.materials;
    var body = "";
    if (state.tab === "materials") body = renderTable(rb.materials || [], "rate");
    else if (state.tab === "labour") body = renderTable(rb.labour || [], "rate");
    else body = renderSchedules(state.schedules || []);

    page.innerHTML =
      '<div class="dk-page-pad">' +
      '<div class="dk-page-head"><h1>' +
      esc(head[0]) +
      "</h1><p>" +
      esc(head[1]) +
      "</p></div>" +
      '<div id="dkRateBody">' +
      body +
      "</div></div>";

    var q = page.querySelector("#dkRateQ");
    if (q) {
      var timer = null;
      q.addEventListener("input", function () {
        state.q = q.value;
        clearTimeout(timer);
        timer = setTimeout(function () {
          paint(page);
          var again = page.querySelector("#dkRateQ");
          if (again) {
            again.focus();
            var len = again.value.length;
            again.setSelectionRange(len, len);
          }
        }, 180);
      });
    }
  }

  function render(host) {
    var page = document.createElement("div");
    page.className = "dk-page";
    host.appendChild(page);
    if (state.tab === "rules") {
      paint(page);
      return;
    }
    page.innerHTML = '<div class="dk-blank"><h2>Loading rates…</h2></div>';
    Promise.all([loadRatebook(), loadSchedules()])
      .then(function () {
        paint(page);
      })
      .catch(function () {
        page.innerHTML =
          '<div class="dk-blank"><h2>Could not load rate book</h2></div>';
      });
  }

  Desk.register("rates", {
    tools: function () {
      return [
        {
          label: "Materials",
          active: state.tab === "materials",
          onClick: function () {
            state.tab = "materials";
            state.q = "";
            Desk.refresh();
          },
        },
        {
          label: "Labour",
          active: state.tab === "labour",
          onClick: function () {
            state.tab = "labour";
            state.q = "";
            Desk.refresh();
          },
        },
        {
          label: "Turnkey",
          active: state.tab === "schedules",
          onClick: function () {
            state.tab = "schedules";
            state.q = "";
            Desk.refresh();
          },
        },
        {
          label: "Phone rules",
          active: state.tab === "rules",
          onClick: function () {
            state.tab = "rules";
            state.q = "";
            if (global.SlmDeskRules && global.SlmDeskRules.reload) {
              global.SlmDeskRules.reload();
            }
            Desk.refresh();
          },
        },
      ];
    },
    render: render,
  });
})(window);
