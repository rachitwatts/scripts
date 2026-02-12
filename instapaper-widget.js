// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: orange; icon-glyph: book-open;

/**
 * Instapaper Reading Queue — Scriptable Widget
 *
 * Shows your unread article count and estimated reading time.
 * Tapping the widget opens a random unread article in Instapaper.
 *
 * SETUP
 * -----
 * 1. Request an API consumer key at:
 *    https://www.instapaper.com/main/request_oauth_consumer_token
 * 2. Once approved, paste your key and secret into the CONFIG section below.
 * 3. Run this script inside the Scriptable app to log in with your
 *    Instapaper email & password (credentials are exchanged for an OAuth
 *    token via xAuth and are never stored).
 * 4. Add a Small or Medium Scriptable widget to your home screen and
 *    pick this script.
 */

// ====================== CONFIG ======================
const CONSUMER_KEY    = "YOUR_CONSUMER_KEY";
const CONSUMER_SECRET = "YOUR_CONSUMER_SECRET";

// Average word count assumed per article (used for time estimate
// since the Instapaper API does not return word counts).
const AVG_WORDS_PER_ARTICLE = 1200;

// Average adult reading speed in words per minute.
const WORDS_PER_MINUTE = 238;

// Minutes before the local bookmark cache is considered stale.
const CACHE_MINUTES = 15;
// ====================================================

// Keychain keys for the stored OAuth token pair.
const KC_TOKEN  = "instapaper_oauth_token";
const KC_SECRET = "instapaper_oauth_secret";

// Local cache filename.
const CACHE_FILE = "instapaper_cache.json";

// ────────────────────────────────────────────────────
// SHA-1 (pure JavaScript — no native crypto needed)
// ────────────────────────────────────────────────────

function sha1Bytes(msg) {
  function rotl(n, s) {
    return (n << s) | (n >>> (32 - s));
  }

  var words = [];
  for (var i = 0; i < msg.length; i++) {
    words[i >> 2] = (words[i >> 2] || 0) | (msg[i] << (24 - (i % 4) * 8));
  }

  var bitLen = msg.length * 8;
  var pi = msg.length >> 2;
  words[pi] = (words[pi] || 0) | (0x80 << (24 - (msg.length % 4) * 8));
  var total = ((msg.length + 8) >> 6 << 4) + 16;
  while (words.length < total) words.push(0);
  words[total - 1] = bitLen;

  var H = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];

  for (var b = 0; b < words.length; b += 16) {
    var W = [];
    for (var t = 0; t < 16; t++) W[t] = words[b + t] || 0;
    for (var t = 16; t < 80; t++)
      W[t] = rotl(W[t - 3] ^ W[t - 8] ^ W[t - 14] ^ W[t - 16], 1);

    var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4];

    for (var t = 0; t < 80; t++) {
      var f, k;
      if (t < 20) {
        f = (bb & c) | (~bb & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = bb ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (bb & c) | (bb & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = bb ^ c ^ d;
        k = 0xca62c1d6;
      }
      var tmp = (rotl(a, 5) + f + e + k + W[t]) & 0xffffffff;
      e = d;
      d = c;
      c = rotl(bb, 30);
      bb = a;
      a = tmp;
    }

    H[0] = (H[0] + a) & 0xffffffff;
    H[1] = (H[1] + bb) & 0xffffffff;
    H[2] = (H[2] + c) & 0xffffffff;
    H[3] = (H[3] + d) & 0xffffffff;
    H[4] = (H[4] + e) & 0xffffffff;
  }

  var out = [];
  for (var i = 0; i < 5; i++) {
    out.push((H[i] >>> 24) & 0xff);
    out.push((H[i] >>> 16) & 0xff);
    out.push((H[i] >>> 8) & 0xff);
    out.push(H[i] & 0xff);
  }
  return out;
}

// ────────────────────────────────────────────────────
// HMAC-SHA1
// ────────────────────────────────────────────────────

function strToBytes(s) {
  var b = [];
  for (var i = 0; i < s.length; i++) b.push(s.charCodeAt(i) & 0xff);
  return b;
}

function bytesToBase64(bytes) {
  var T =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var r = "";
  for (var i = 0; i < bytes.length; i += 3) {
    var b1 = bytes[i],
      b2 = bytes[i + 1] || 0,
      b3 = bytes[i + 2] || 0;
    r += T[(b1 >> 2) & 0x3f];
    r += T[((b1 & 3) << 4) | ((b2 >> 4) & 0xf)];
    r += i + 1 < bytes.length ? T[((b2 & 0xf) << 2) | ((b3 >> 6) & 3)] : "=";
    r += i + 2 < bytes.length ? T[b3 & 0x3f] : "=";
  }
  return r;
}

function hmacSha1(key, message) {
  var kb = strToBytes(key);
  var mb = strToBytes(message);
  if (kb.length > 64) kb = sha1Bytes(kb);
  while (kb.length < 64) kb.push(0);

  var ipad = [],
    opad = [];
  for (var i = 0; i < 64; i++) {
    ipad.push(kb[i] ^ 0x36);
    opad.push(kb[i] ^ 0x5c);
  }

  return bytesToBase64(sha1Bytes(opad.concat(sha1Bytes(ipad.concat(mb)))));
}

// ────────────────────────────────────────────────────
// OAuth 1.0a helpers
// ────────────────────────────────────────────────────

function pctEnc(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

function oauthNonce() {
  var c =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var n = "";
  for (var i = 0; i < 32; i++)
    n += c[Math.floor(Math.random() * c.length)];
  return n;
}

function oauthSign(method, url, params, consumerSecret, tokenSecret) {
  var sorted = Object.keys(params)
    .sort()
    .map(function (k) {
      return pctEnc(k) + "=" + pctEnc(params[k]);
    })
    .join("&");

  var base = method + "&" + pctEnc(url) + "&" + pctEnc(sorted);
  var key = pctEnc(consumerSecret) + "&" + pctEnc(tokenSecret || "");
  return hmacSha1(key, base);
}

function oauthHeader(params) {
  return (
    "OAuth " +
    Object.keys(params)
      .sort()
      .map(function (k) {
        return pctEnc(k) + '="' + pctEnc(params[k]) + '"';
      })
      .join(", ")
  );
}

// ────────────────────────────────────────────────────
// Instapaper API transport
// ────────────────────────────────────────────────────

function buildRequest(endpoint, bodyParams, token, tokenSecret) {
  var url = "https://www.instapaper.com" + endpoint;

  var oa = {
    oauth_consumer_key: CONSUMER_KEY,
    oauth_nonce: oauthNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
  };
  if (token) oa.oauth_token = token;

  // Signature is computed over *all* params (OAuth + body).
  var all = Object.assign({}, oa, bodyParams || {});
  oa.oauth_signature = oauthSign(
    "POST",
    url,
    all,
    CONSUMER_SECRET,
    tokenSecret || ""
  );

  var req = new Request(url);
  req.method = "POST";
  req.headers = {
    Authorization: oauthHeader(oa),
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (bodyParams && Object.keys(bodyParams).length) {
    req.body = Object.keys(bodyParams)
      .map(function (k) {
        return encodeURIComponent(k) + "=" + encodeURIComponent(bodyParams[k]);
      })
      .join("&");
  }

  return req;
}

// ────────────────────────────────────────────────────
// Authentication (xAuth → OAuth token)
// ────────────────────────────────────────────────────

async function authenticate(username, password) {
  var req = buildRequest("/api/1/oauth/access_token", {
    x_auth_username: username,
    x_auth_password: password,
    x_auth_mode: "client_auth",
  });

  var text = await req.loadString();
  var parts = {};
  text.split("&").forEach(function (pair) {
    var kv = pair.split("=");
    parts[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
  });

  if (!parts.oauth_token) {
    throw new Error("Authentication failed — check your credentials.");
  }

  return { token: parts.oauth_token, secret: parts.oauth_token_secret };
}

// ────────────────────────────────────────────────────
// Bookmarks
// ────────────────────────────────────────────────────

async function fetchUnreadBookmarks(token, tokenSecret) {
  var req = buildRequest(
    "/api/1/bookmarks/list",
    { folder_id: "unread", limit: "500" },
    token,
    tokenSecret
  );

  var json = await req.loadJSON();

  // The bookmarks/list endpoint returns { bookmarks: [...] }.
  // Fall back to filtering an array response by type, just in case.
  if (json && json.bookmarks) return json.bookmarks;
  if (Array.isArray(json))
    return json.filter(function (o) {
      return o.type === "bookmark";
    });
  return [];
}

// ────────────────────────────────────────────────────
// Local cache (FileManager)
// ────────────────────────────────────────────────────

function cachePath() {
  var fm = FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), CACHE_FILE);
}

function readCache() {
  var fm = FileManager.local();
  var p = cachePath();
  if (!fm.fileExists(p)) return null;
  try {
    var data = JSON.parse(fm.readString(p));
    if (Date.now() - data.ts < CACHE_MINUTES * 60 * 1000) return data;
  } catch (e) {
    /* ignore corrupt cache */
  }
  return null;
}

function readStaleCache() {
  var fm = FileManager.local();
  var p = cachePath();
  if (!fm.fileExists(p)) return null;
  try {
    return JSON.parse(fm.readString(p));
  } catch (e) {
    return null;
  }
}

function writeCache(bookmarks) {
  var fm = FileManager.local();
  fm.writeString(
    cachePath(),
    JSON.stringify({ ts: Date.now(), bookmarks: bookmarks })
  );
}

// ────────────────────────────────────────────────────
// Credential helpers (Keychain)
// ────────────────────────────────────────────────────

function hasCredentials() {
  return Keychain.contains(KC_TOKEN) && Keychain.contains(KC_SECRET);
}

function getCredentials() {
  return { token: Keychain.get(KC_TOKEN), secret: Keychain.get(KC_SECRET) };
}

function saveCredentials(token, secret) {
  Keychain.set(KC_TOKEN, token);
  Keychain.set(KC_SECRET, secret);
}

// ────────────────────────────────────────────────────
// Widget rendering
// ────────────────────────────────────────────────────

function formatTime(minutes) {
  var h = Math.floor(minutes / 60);
  var m = Math.round(minutes % 60);
  if (h > 0) return h + "h " + m + "m";
  return m + " min";
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function createWidget(bookmarks) {
  var count = bookmarks.length;
  var totalMin = (count * AVG_WORDS_PER_ARTICLE) / WORDS_PER_MINUTE;

  var w = new ListWidget();

  // ── Colours ──
  var bg = new Color("#1a1a2e");
  var accent = new Color("#64ffda");
  var muted = new Color("#8892b0");
  var warm = new Color("#e6c07b");

  w.backgroundColor = bg;
  w.setPadding(14, 14, 14, 14);

  // ── Header ──
  var hdr = w.addText("INSTAPAPER");
  hdr.font = Font.boldSystemFont(11);
  hdr.textColor = accent;

  w.addSpacer(4);

  // ── Article count ──
  var num = w.addText(String(count));
  num.font = Font.boldSystemFont(42);
  num.textColor = Color.white();
  num.minimumScaleFactor = 0.5;

  var lbl = w.addText(count === 1 ? "unread article" : "unread articles");
  lbl.font = Font.regularSystemFont(13);
  lbl.textColor = muted;

  w.addSpacer(6);

  // ── Reading-time estimate ──
  var timeText = w.addText("\u{23F1} ~" + formatTime(totalMin));
  timeText.font = Font.mediumSystemFont(14);
  timeText.textColor = warm;

  w.addSpacer(null); // push remaining content to bottom

  // ── Random-article prompt ──
  if (count > 0) {
    var random = pickRandom(bookmarks);

    // Show title preview on medium / large widgets.
    var family = config.widgetFamily;
    if (family === "medium" || family === "large") {
      var title = random.title || "Untitled";
      if (title.length > 60) title = title.substring(0, 57) + "...";
      var preview = w.addText(title);
      preview.font = Font.regularSystemFont(11);
      preview.textColor = Color.white();
      preview.lineLimit = 2;
      w.addSpacer(2);
    }

    var hint = w.addText("Tap to open a random article");
    hint.font = Font.italicSystemFont(10);
    hint.textColor = muted;
    hint.textOpacity = 0.7;

    // Universal link — opens in the Instapaper app when installed.
    w.url = "https://www.instapaper.com/read/" + random.bookmark_id;
  } else {
    var empty = w.addText("Queue is empty!");
    empty.font = Font.italicSystemFont(11);
    empty.textColor = accent;
    w.url = "https://www.instapaper.com";
  }

  return w;
}

function createErrorWidget(message) {
  var w = new ListWidget();
  w.backgroundColor = new Color("#1a1a2e");
  w.setPadding(14, 14, 14, 14);

  var t = w.addText("INSTAPAPER");
  t.font = Font.boldSystemFont(11);
  t.textColor = new Color("#ff6b6b");

  w.addSpacer(8);

  var e = w.addText(message);
  e.font = Font.regularSystemFont(12);
  e.textColor = Color.white();

  w.url = "https://www.instapaper.com";
  return w;
}

// ────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────

async function main() {
  // --- Running inside the Scriptable app (not as a widget) ---
  if (!config.runsInWidget) {
    // Prompt for login if we have no stored token yet.
    if (!hasCredentials()) {
      var alert = new Alert();
      alert.title = "Instapaper Login";
      alert.message =
        "Enter your Instapaper credentials.\n" +
        "They are exchanged for an OAuth token and never stored.";
      alert.addTextField("Email");
      alert.addSecureTextField("Password");
      alert.addAction("Log In");
      alert.addCancelAction("Cancel");

      var idx = await alert.presentAlert();
      if (idx === -1) return;

      try {
        var creds = await authenticate(
          alert.textFieldValue(0),
          alert.textFieldValue(1)
        );
        saveCredentials(creds.token, creds.secret);

        var ok = new Alert();
        ok.title = "Authenticated";
        ok.message =
          "You're all set. Add a Scriptable widget to your " +
          "home screen and select this script.";
        ok.addAction("OK");
        await ok.presentAlert();
      } catch (e) {
        var fail = new Alert();
        fail.title = "Login Failed";
        fail.message = String(e.message || e);
        fail.addAction("OK");
        await fail.presentAlert();
        return;
      }
    }

    // Show a preview of the widget.
    if (hasCredentials()) {
      var cred = getCredentials();
      var bookmarks;
      try {
        bookmarks = await fetchUnreadBookmarks(cred.token, cred.secret);
        writeCache(bookmarks);
      } catch (e) {
        var stale = readStaleCache();
        bookmarks = stale ? stale.bookmarks : [];
      }
      var preview = await createWidget(bookmarks);
      preview.presentSmall();
    }
    return;
  }

  // --- Running as a home-screen widget ---

  if (!hasCredentials()) {
    Script.setWidget(createErrorWidget("Open Scriptable to log in"));
    Script.complete();
    return;
  }

  var cred = getCredentials();
  var bookmarks;

  // Prefer a fresh cache to avoid unnecessary API calls.
  var cached = readCache();
  if (cached) {
    bookmarks = cached.bookmarks;
  } else {
    try {
      bookmarks = await fetchUnreadBookmarks(cred.token, cred.secret);
      writeCache(bookmarks);
    } catch (e) {
      var stale = readStaleCache();
      if (stale) {
        bookmarks = stale.bookmarks;
      } else {
        Script.setWidget(createErrorWidget("Network error"));
        Script.complete();
        return;
      }
    }
  }

  var widget = await createWidget(bookmarks);
  Script.setWidget(widget);
  Script.complete();
}

await main();
