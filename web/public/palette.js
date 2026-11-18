(function () {
  var ok = ["hn", "highlighter", "cobalt", "violet"];
  var p = new URLSearchParams(location.search).get("palette");
  try { if (!p) p = localStorage.getItem("resurface-palette"); } catch (e) {}
  if (ok.indexOf(p) >= 0) document.documentElement.dataset.palette = p;
})();
