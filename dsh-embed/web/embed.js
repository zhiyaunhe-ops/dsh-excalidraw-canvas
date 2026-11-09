(function () {
  // dsh web 被反代到画布同源的 /dsh/；/dsh/login 会带上 dsh 登录 cookie 再跳过去
  var LOGIN_URL = "/dsh/login";
  var KEY = "dsh-embed-open-v1";
  // 画布身份：画布库「载入画布」时写入当前画布的 stem，同源共享
  var CANVAS_KEY = "dsh-canvas-current";
  var LIVE_STEM = "live";
  if (document.getElementById("dsh-embed-panel")) return;

  function canvasStem() {
    try {
      var v = localStorage.getItem(CANVAS_KEY);
      if (v) return v;
    } catch (e) {}
    return LIVE_STEM;
  }

  function frameUrl(bust) {
    var url = LOGIN_URL + "?canvas=" + encodeURIComponent(canvasStem());
    if (bust) url += "&t=" + Date.now();
    return url;
  }

  var btn = document.createElement("button");
  btn.id = "dsh-embed-toggle";
  btn.className = "dsh-embed-btn";
  btn.type = "button";
  btn.title = "在画布上打开 dsh 对话窗口";
  btn.textContent = "💬 dsh";

  var panel = document.createElement("div");
  panel.id = "dsh-embed-panel";
  panel.className = "dsh-embed-panel";
  panel.innerHTML =
    '<div class="dsh-embed-bar">' +
    '<span class="dsh-embed-title">dsh 对话</span>' +
    '<button type="button" id="dsh-embed-relogin" title="重新登录 dsh">重登</button>' +
    '<button type="button" id="dsh-embed-newtab" title="在新标签打开">新标签</button>' +
    '<button type="button" id="dsh-embed-close" title="收起">✕</button>' +
    "</div>" +
    '<iframe id="dsh-embed-frame" class="dsh-embed-frame" title="dsh"></iframe>';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var frame = panel.querySelector("#dsh-embed-frame");

  function load(url) {
    frame.setAttribute("src", url);
  }
  function open() {
    if (!frame.getAttribute("src")) load(frameUrl(false));
    panel.classList.add("open");
    btn.style.display = "none";
    try { localStorage.setItem(KEY, "1"); } catch (e) {}
  }
  function close() {
    panel.classList.remove("open");
    btn.style.display = "";
    try { localStorage.setItem(KEY, "0"); } catch (e) {}
  }

  btn.addEventListener("click", open);
  panel.querySelector("#dsh-embed-newtab").addEventListener("click", function () {
    window.open(frameUrl(false), "_blank", "noopener");
  });
  panel.querySelector("#dsh-embed-close").addEventListener("click", close);
  panel.querySelector("#dsh-embed-relogin").addEventListener("click", function () {
    load(frameUrl(true));
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel.classList.contains("open")) close();
  });

  // 画布库切到另一张画布时，小窗跟着换到那张画布绑定的 session
  window.addEventListener("storage", function (e) {
    if (e.key !== CANVAS_KEY) return;
    if (panel.classList.contains("open")) load(frameUrl(true));
  });

  try { if (localStorage.getItem(KEY) === "1") open(); } catch (e) {}
})();
