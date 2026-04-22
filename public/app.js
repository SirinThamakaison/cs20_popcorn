var currentUser = null;
var selectedMovie = null;

//shorthand for getElementById
function $(id) {
  return document.getElementById(id);
}

//putting a message under login forms
function showMsg(el, text, isError) {
  el.textContent = text || "";
  el.style.color = isError ? "#a12a2a" : "#2b5c2b";
}

//wrapper for fetch so we always send cookies
async function api(path, options) {
  var opts = options || {};
  opts.credentials = "include";
  opts.headers = opts.headers || {};
  if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }
  var res = await fetch(path, opts);
  var data = {};
  try {
    data = await res.json();
  } catch (e) {
    data = { ok: false, error: "bad response" };
  }
  if (!res.ok && !data.error) {
    data.error = "request failed";
  }
  return data;
}

//switching between logged in view and logged out view
function setLoggedInUi(loggedIn, username) {
  var authArea = $("authArea");
  var loginSection = $("loginSection");
  var registerSection = $("registerSection");
  var appSection = $("appSection");

  if (loggedIn) {
    currentUser = username;
    authArea.innerHTML =
      '<span class="pill">' +
      escapeHtml(username) +
      '</span> <button type="button" id="btnLogout">log out</button>';
    $("btnLogout").onclick = doLogout;
    loginSection.classList.add("hidden");
    registerSection.classList.add("hidden");
    appSection.classList.remove("hidden");
    $("welcomeName").textContent = username;
    loadLists();
  } else {
    currentUser = null;
    authArea.innerHTML =
      '<button type="button" id="btnShowLogin">log in</button> ' +
      '<button type="button" id="btnShowRegister">register</button>';
    $("btnShowLogin").onclick = function () {
      showLoginPanel();
    };
    $("btnShowRegister").onclick = function () {
      showRegisterPanel();
    };
    appSection.classList.add("hidden");
    loginSection.classList.remove("hidden");
    registerSection.classList.add("hidden");
  }
}

//show login card hide register
function showLoginPanel() {
  $("loginSection").classList.remove("hidden");
  $("registerSection").classList.add("hidden");
}

//show register card hide login
function showRegisterPanel() {
  $("registerSection").classList.remove("hidden");
  $("loginSection").classList.add("hidden");
}

//stops random html in movie titles from breaking the page
function escapeHtml(s) {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

//asking server if we still have a session cookie
async function checkSession() {
  var data = await api("/api/me");
  if (data.ok && data.loggedIn && data.username) {
    setLoggedInUi(true, data.username);
  } else {
    setLoggedInUi(false);
  }
}

//logout button
async function doLogout() {
  await api("/api/logout", { method: "POST" });
  setLoggedInUi(false);
}

//login form submit
async function doLogin() {
  var u = $("loginUser").value.trim();
  var p = $("loginPass").value;
  showMsg($("loginMsg"), "wait...", false);
  var data = await api("/api/login", {
    method: "POST",
    body: { username: u, password: p },
  });
  if (data.ok) {
    showMsg($("loginMsg"), "", false);
    $("loginPass").value = "";
    setLoggedInUi(true, data.username);
  } else {
    showMsg($("loginMsg"), data.error || "nope", true);
  }
}

//register form submit
async function doRegister() {
  var u = $("regUser").value.trim();
  var p = $("regPass").value;
  showMsg($("regMsg"), "wait...", false);
  var data = await api("/api/register", {
    method: "POST",
    body: { username: u, password: p },
  });
  if (data.ok) {
    showMsg($("regMsg"), "", false);
    $("regPass").value = "";
    setLoggedInUi(true, data.username);
  } else {
    showMsg($("regMsg"), data.error || "nope", true);
  }
}

//turning rating number into star text
function stars(n) {
  var s = "";
  for (var i = 0; i < n; i++) s += "★";
  for (var j = n; j < 5; j++) s += "☆";
  return s;
}

//search button calls our api then builds divs for each hit
async function runSearch() {
  var q = $("searchInput").value.trim();
  var box = $("searchResults");
  box.innerHTML = "";
  if (!q) {
    showMsg($("searchMsg"), "type a name", true);
    return;
  }
  showMsg($("searchMsg"), "...", false);
  var data = await api("/api/movies/search?q=" + encodeURIComponent(q));
  if (!data.ok) {
    showMsg($("searchMsg"), data.error || "error", true);
    return;
  }
  showMsg($("searchMsg"), data.message || "", !!data.message);
  if (!data.results.length) {
    box.innerHTML = "<p class='small'>nothing found</p>";
    return;
  }
  for (var i = 0; i < data.results.length; i++) {
    var m = data.results[i];
    var div = document.createElement("div");
    div.className = "hit";
    var imgHtml = m.poster
      ? "<img src='" + escapeHtml(m.poster) + "' alt='' />"
      : "<div class='small' style='width:54px'>no pic</div>";
    div.innerHTML =
      imgHtml +
      "<div class='meta'><div class='title'>" +
      escapeHtml(m.title) +
      "</div><div class='small'>" +
      escapeHtml(m.year || "") +
      " · " +
      escapeHtml(m.type || "") +
      "</div></div>";
    div.onclick = (function (id) {
      return function () {
        loadDetail(id);
      };
    })(m.imdbId);
    box.appendChild(div);
  }
}

//when you click a search row we load the plot for that imdb id
async function loadDetail(imdbId) {
  selectedMovie = null;
  $("detailBox").classList.add("empty");
  $("detailBox").innerHTML = "loading";
  var data = await api("/api/movies/detail?id=" + encodeURIComponent(imdbId));
  if (!data.ok || !data.movie) {
    $("detailBox").innerHTML = "didnt work";
    return;
  }
  selectedMovie = data.movie;
  var m = data.movie;
  var poster = m.poster
    ? "<img src='" + escapeHtml(m.poster) + "' alt='poster' />"
    : "<div class='small'>no pic</div>";
  var html = "";
  html += poster;
  html += "<div><h3 style='margin:0 0 0.5rem'>" + escapeHtml(m.title) + "</h3>";
  html += "<p class='small'>" + escapeHtml(m.year || "") + "</p>";
  html += "<p>" + escapeHtml(m.plot) + "</p>";
  html += '<div class="detail-actions">';
  html += '<div class="inline-btns">';
  html += '<button type="button" id="btnAddWant">watch later</button>';
  html += '<button type="button" class="secondary" id="btnSeenForm">watched + rate</button>';
  html += "</div>";
  html += '<div id="seenFormWrap" class="hidden">';
  html += "<label>stars<select id='rateSelect'>";
  for (var r = 1; r <= 5; r++) {
    html += "<option value='" + r + "'>" + r + "</option>";
  }
  html += "</select></label>";
  html += "<label>review<textarea id='reviewText'></textarea></label>";
  html += '<button type="button" id="btnSaveSeen">save watched</button>';
  html += "</div>";
  html += "</div></div>";
  $("detailBox").classList.remove("empty");
  $("detailBox").innerHTML = html;
  $("btnAddWant").onclick = addWant;
  $("btnSeenForm").onclick = function () {
    $("seenFormWrap").classList.toggle("hidden");
  };
  $("btnSaveSeen").onclick = saveSeen;
}

//posting want status to mongo
async function addWant() {
  if (!selectedMovie) return;
  var data = await api("/api/my-movies", {
    method: "POST",
    body: {
      imdbId: selectedMovie.imdbId,
      title: selectedMovie.title,
      poster: selectedMovie.poster,
      plot: selectedMovie.plot,
      status: "want",
    },
  });
  if (!data.ok) {
    alert(data.error || "error");
    return;
  }
  alert("ok added");
  loadLists();
}

//posting seen + stars + review text to mongo
async function saveSeen() {
  if (!selectedMovie) return;
  var rating = parseInt($("rateSelect").value, 10);
  var reviewText = $("reviewText").value;
  var data = await api("/api/my-movies", {
    method: "POST",
    body: {
      imdbId: selectedMovie.imdbId,
      title: selectedMovie.title,
      poster: selectedMovie.poster,
      plot: selectedMovie.plot,
      status: "seen",
      rating: rating,
      reviewText: reviewText,
    },
  });
  if (!data.ok) {
    alert(data.error || "error");
    return;
  }
  alert("ok saved");
  loadLists();
}

//pulling both lists after login or refresh
async function loadLists() {
  if (!currentUser) return;
  var sortWant = $("sortWant").value;
  var sortSeen = $("sortSeen").value;

  var wantData = await api("/api/my-movies?status=want&sort=" + encodeURIComponent(sortWant));
  var seenData = await api("/api/my-movies?status=seen&sort=" + encodeURIComponent(sortSeen));

  renderList($("listWant"), wantData.movies || [], "want");
  renderList($("listSeen"), seenData.movies || [], "seen");
}

//building the html for watchlist or watched list
function renderList(container, movies, kind) {
  container.innerHTML = "";
  if (!movies.length) {
    container.innerHTML = "<p class='small'>empty</p>";
    return;
  }
  for (var i = 0; i < movies.length; i++) {
    var m = movies[i];
    var row = document.createElement("div");
    row.className = "movie-row";
    var img = m.poster
      ? "<img src='" + escapeHtml(m.poster) + "' alt='' />"
      : "<div style='width:56px'></div>";
    var extra = "";
    if (kind === "seen") {
      extra +=
        "<div class='stars'>" +
        stars(m.rating || 0) +
        "</div>" +
        "<p class='small'>" +
        escapeHtml(m.reviewText || "(no review)") +
        "</p>";
    } else {
      extra += "<p class='small'>" + escapeHtml(m.plot || "") + "</p>";
    }
    row.innerHTML =
      img +
      "<div class='body'><strong>" +
      escapeHtml(m.title) +
      "</strong>" +
      extra +
      "<button type='button' class='secondary' data-imdb='" +
      escapeHtml(m.imdbId) +
      "'>remove</button></div>";
    container.appendChild(row);
    var b = row.querySelector("button");
    b.onclick = function () {
      var id = this.getAttribute("data-imdb");
      removeMovie(id);
    };
  }
}

//delete route for one imdb id
async function removeMovie(imdbId) {
  if (!confirm("delete?")) return;
  var data = await api("/api/my-movies/" + encodeURIComponent(imdbId), {
    method: "DELETE",
  });
  if (!data.ok) {
    alert(data.error || "error");
    return;
  }
  loadLists();
}

//hooking up buttons when page loads
window.onload = function () {
  checkSession();

  $("btnLogin").onclick = doLogin;
  $("btnRegister").onclick = doRegister;
  $("linkShowRegister").onclick = function (e) {
    e.preventDefault();
    showRegisterPanel();
  };
  $("linkShowLogin").onclick = function (e) {
    e.preventDefault();
    showLoginPanel();
  };

  $("btnSearch").onclick = runSearch;
  $("searchInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") runSearch();
  });

  $("sortWant").onchange = loadLists;
  $("sortSeen").onchange = loadLists;
  $("btnRefreshWant").onclick = loadLists;
  $("btnRefreshSeen").onclick = loadLists;
};
