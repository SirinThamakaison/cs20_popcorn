//loading env file so MONGODB_URI works
require("dotenv").config();
//pulling in express and mongo stuff
var express = require("express");
var http = require("http");
var session = require("express-session");
var bcrypt = require("bcryptjs");
var path = require("path");
var { MongoClient, ObjectId } = require("mongodb");

//making the main express app
var app = express();
var PORT = process.env.PORT || 3001;

//reading keys from .env
var mongoUri = process.env.MONGODB_URI;
var omdbKey = process.env.OMDB_API_KEY;
var sessionSecret = process.env.SESSION_SECRET || "dev-only-secret-change-me";

if (!mongoUri) {
  console.log("need MONGODB_URI in .env");
  process.exit(1);
}

//mongo client we use for the whole server
var client = new MongoClient(mongoUri);
var db;

//middleware so post bodies come in as json
app.use(express.json());
//session middleware keeps you logged in with a cookie
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);
//sending out the files in public folder
app.use(express.static(path.join(__dirname, "public")));

//little helper to grab the db variable
function getDb() {
  return db;
}

//stops api if you arent logged in
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    res.status(401).json({ ok: false, error: "not logged in" });
    return;
  }
  next();
}

//implementing register route
app.post("/api/register", async function (req, res) {
  try {
    var username = (req.body.username || "").trim();
    var password = req.body.password || "";
    if (username.length < 2 || password.length < 4) {
      res.status(400).json({ ok: false, error: "username or password too short" });
      return;
    }
    var users = getDb().collection("users");
    var existing = await users.findOne({ username: username });
    if (existing) {
      res.status(400).json({ ok: false, error: "username already taken" });
      return;
    }
    var hash = bcrypt.hashSync(password, 10);
    var result = await users.insertOne({ username: username, passwordHash: hash });
    req.session.userId = result.insertedId.toString();
    req.session.username = username;
    res.json({ ok: true, username: username });
  } catch (e) {
    console.log("register error", e);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

//implementing login section
app.post("/api/login", async function (req, res) {
  try {
    var username = (req.body.username || "").trim();
    var password = req.body.password || "";
    var users = getDb().collection("users");
    var user = await users.findOne({ username: username });
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      res.status(400).json({ ok: false, error: "wrong username or password" });
      return;
    }
    req.session.userId = user._id.toString();
    req.session.username = user.username;
    res.json({ ok: true, username: user.username });
  } catch (e) {
    console.log("login error", e);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

//logging out clears the session
app.post("/api/logout", function (req, res) {
  req.session.destroy(function () {
    res.json({ ok: true });
  });
});

//checking if someone is logged in for the front page
app.get("/api/me", function (req, res) {
  if (!req.session.userId) {
    res.json({ ok: true, loggedIn: false });
    return;
  }
  res.json({
    ok: true,
    loggedIn: true,
    username: req.session.username,
  });
});

//searching omdb by title string
app.get("/api/movies/search", async function (req, res) {
  try {
    if (!omdbKey) {
      res.status(500).json({ ok: false, error: "OMDB_API_KEY missing in .env" });
      return;
    }
    var q = (req.query.q || "").trim();
    if (q.length < 1) {
      res.json({ ok: true, results: [] });
      return;
    }
    var url =
      "https://www.omdbapi.com/?apikey=" +
      encodeURIComponent(omdbKey) +
      "&s=" +
      encodeURIComponent(q);
    var r = await fetch(url);
    var data = await r.json();
    if (data.Response === "False" || !data.Search) {
      res.json({ ok: true, results: [], message: data.Error || "" });
      return;
    }
    var results = data.Search.map(function (item) {
      return {
        imdbId: item.imdbID,
        title: item.Title,
        year: item.Year,
        poster: item.Poster && item.Poster !== "N/A" ? item.Poster : "",
        type: item.Type,
      };
    });
    res.json({ ok: true, results: results });
  } catch (e) {
    console.log("search error", e);
    res.status(500).json({ ok: false, error: "search failed" });
  }
});

//getting one movie plot and poster from omdb
app.get("/api/movies/detail", async function (req, res) {
  try {
    if (!omdbKey) {
      res.status(500).json({ ok: false, error: "OMDB_API_KEY missing in .env" });
      return;
    }
    var id = (req.query.id || "").trim();
    if (!id) {
      res.status(400).json({ ok: false, error: "missing id" });
      return;
    }
    var url =
      "https://www.omdbapi.com/?apikey=" +
      encodeURIComponent(omdbKey) +
      "&i=" +
      encodeURIComponent(id) +
      "&plot=short";
    var r = await fetch(url);
    var data = await r.json();
    if (data.Response === "False") {
      res.status(404).json({ ok: false, error: data.Error || "not found" });
      return;
    }
    res.json({
      ok: true,
      movie: {
        imdbId: data.imdbID,
        title: data.Title,
        year: data.Year,
        poster: data.Poster && data.Poster !== "N/A" ? data.Poster : "",
        plot: data.Plot && data.Plot !== "N/A" ? data.Plot : "No description.",
      },
    });
  } catch (e) {
    console.log("detail error", e);
    res.status(500).json({ ok: false, error: "detail failed" });
  }
});

//loading the users watchlist or seen list from mongo
app.get("/api/my-movies", requireLogin, async function (req, res) {
  try {
    var userId = new ObjectId(req.session.userId);
    var filter = { userId: userId };
    var status = req.query.status;
    if (status === "want" || status === "seen") {
      filter.status = status;
    }
    var col = getDb().collection("user_movies");
    var sortMode = req.query.sort || "added";

    //default sort is newest updated first
    var sortObj = { updatedAt: -1 };
    //if they are on the watched tab we sort by stars or title
    if (status === "seen") {
      if (sortMode === "rating_high") {
        sortObj = { rating: -1, title: 1 };
      } else if (sortMode === "rating_low") {
        sortObj = { rating: 1, title: 1 };
      } else if (sortMode === "title") {
        sortObj = { title: 1 };
      }
    } else if (status === "want" && sortMode === "title") {
      sortObj = { title: 1 };
    }

    var docs = await col.find(filter).sort(sortObj).toArray();

    res.json({ ok: true, movies: docs });
  } catch (e) {
    console.log("my-movies error", e);
    res.status(500).json({ ok: false, error: "could not load list" });
  }
});

//saving a movie as want to watch or already seen with rating
app.post("/api/my-movies", requireLogin, async function (req, res) {
  try {
    var userId = new ObjectId(req.session.userId);
    var imdbId = (req.body.imdbId || "").trim();
    var title = (req.body.title || "").trim();
    var poster = req.body.poster || "";
    var plot = req.body.plot || "";
    var status = req.body.status;
    if (!imdbId || !title) {
      res.status(400).json({ ok: false, error: "missing movie info" });
      return;
    }
    if (status !== "want" && status !== "seen") {
      res.status(400).json({ ok: false, error: "status should be want or seen" });
      return;
    }

    var rating = parseInt(req.body.rating, 10);
    var reviewText = (req.body.reviewText || "").trim();

    //seen needs a real rating 1 through 5
    if (status === "seen") {
      if (isNaN(rating) || rating < 1 || rating > 5) {
        res.status(400).json({ ok: false, error: "rating must be 1-5 for seen movies" });
        return;
      }
    } else {
      rating = null;
      reviewText = "";
    }

    var col = getDb().collection("user_movies");
    var now = new Date();

    //one row per user per imdb id, upsert updates if it already exists
    var updateDoc = {
      userId: userId,
      imdbId: imdbId,
      title: title,
      poster: poster,
      plot: plot,
      status: status,
      rating: status === "seen" ? rating : null,
      reviewText: status === "seen" ? reviewText : "",
      updatedAt: now,
    };

    await col.updateOne(
      { userId: userId, imdbId: imdbId },
      {
        $set: updateDoc,
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    res.json({ ok: true });
  } catch (e) {
    console.log("save movie error", e);
    res.status(500).json({ ok: false, error: "could not save" });
  }
});

//deleting a movie row for this user
app.delete("/api/my-movies/:imdbId", requireLogin, async function (req, res) {
  try {
    var userId = new ObjectId(req.session.userId);
    var imdbId = req.params.imdbId;
    var col = getDb().collection("user_movies");
    await col.deleteOne({ userId: userId, imdbId: imdbId });
    res.json({ ok: true });
  } catch (e) {
    console.log("delete error", e);
    res.status(500).json({ ok: false, error: "could not delete" });
  }
});

//starting mongo connection then the web server
async function start() {
  await client.connect();
  db = client.db("popcorn");
  //indexes so usernames dont duplicate and same movie doesnt duplicate per user
  await db.collection("users").createIndex({ username: 1 }, { unique: true });
  await db.collection("user_movies").createIndex({ userId: 1, imdbId: 1 }, { unique: true });
  console.log("mongodb connected");

  //using createServer so we can listen for port errors before listen finishes
  var server = http.createServer(app);
  server.on("error", function (err) {
    if (err && err.code === "EADDRINUSE") {
      console.log("port " + PORT + " busy");
      console.log("try PORT=3002 npm start");
      process.exit(1);
    }
    throw err;
  });
  server.listen(PORT, function () {
    console.log("http://localhost:" + PORT);
    if (!omdbKey) {
      console.log("no OMDB_API_KEY");
    }
  });
}

start().catch(function (err) {
  console.log("start failed", err);
  process.exit(1);
});
