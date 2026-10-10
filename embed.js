/*!
 * Today in the Badlands embed — Theodore Roosevelt Presidential Library
 * https://today.labs.trlibrary.com
 *
 * Usage (one script tag per page, any number of widgets):
 *
 *   <div data-badlands-today="strip"></div>
 *   <script src="https://today.labs.trlibrary.com/embed.js" async></script>
 *
 * Layouts: strip | conditions | todo | full
 * Optional attributes:
 *   data-show="alerts,weather,river,air,sky,todo"  pick pieces
 *   data-unit="all|south|north|elkhorn"           starting park unit for activity cards
 *   data-time="all|quick|short|long|any"          starting time filter
 *   data-theme="light|dark"
 *   data-min-height="520"                         space held before the widget reports its size
 */
(function () {
  "use strict";
  var ORIGIN = "https://today.labs.trlibrary.com";
  try {
    var me = document.currentScript && document.currentScript.src;
    if (me) ORIGIN = new URL(me).origin;
  } catch (e) {}

  var frames = {};
  var n = 0;
  var PASS = ["show", "unit", "time", "theme"];

  function mount(el) {
    if (el.getAttribute("data-bt-mounted")) return;
    el.setAttribute("data-bt-mounted", "1");
    var view = el.getAttribute("data-badlands-today") || "strip";
    var id = "bt" + ++n;
    var q = "?embed=1&id=" + id + "&view=" + encodeURIComponent(view);
    for (var i = 0; i < PASS.length; i++) {
      var v = el.getAttribute("data-" + PASS[i]);
      if (v) q += "&" + PASS[i] + "=" + encodeURIComponent(v);
    }
    var f = document.createElement("iframe");
    f.src = ORIGIN + "/" + q;
    f.title = "Today in the Badlands — conditions in Theodore Roosevelt National Park";
    f.loading = "lazy";
    f.style.cssText = "width:100%;border:0;display:block;overflow:hidden;background:transparent;height:" + (parseInt(el.getAttribute("data-min-height"), 10) || 520) + "px";
    f.setAttribute("allowtransparency", "true");
    el.appendChild(f);
    frames[id] = f;
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== ORIGIN || !e.data || e.data.type !== "badlands-today:height") return;
    var f = frames[e.data.id];
    if (f && e.data.height) f.style.height = Math.ceil(e.data.height) + "px";
  });

  function scan() {
    var els = document.querySelectorAll("[data-badlands-today]");
    for (var i = 0; i < els.length; i++) mount(els[i]);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  else scan();
})();
