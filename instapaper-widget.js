// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: orange; icon-glyph: book-open;

/**
 * Instapaper Reading Queue — Scriptable Widget
 *
 * Displays a random unread article (image + title). Tapping the
 * widget opens that article in Instapaper. A separator at the
 * bottom shows how many unread articles remain and the estimated
 * total reading time.
 *
 * SETUP
 * -----
 * 1. Request an API consumer key at:
 *    https://www.instapaper.com/main/request_oauth_consumer_token
 * 2. Once approved, paste your key and secret into the CONFIG section below.
 * 3. Run this script once inside the Scriptable app to log in with your
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

// Local cache filenames.
const CACHE_FILE    = "instapaper_cache.json";
const FEATURED_IMG  = "instapaper_featured.png";

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

  if (json && json.bookmarks) return json.bookmarks;
  if (Array.isArray(json))
    return json.filter(function (o) {
      return o.type === "bookmark";
    });
  return [];
}

// ────────────────────────────────────────────────────
// Article image (Open Graph)
// ────────────────────────────────────────────────────

async function fetchArticleImage(articleUrl) {
  try {
    var req = new Request(articleUrl);
    req.timeoutInterval = 8;
    var html = await req.loadString();

    // Try property-first, then content-first ordering of the og:image tag.
    var match = html.match(
      /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i
    );
    if (!match) {
      match = html.match(
        /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i
      );
    }

    if (match && match[1]) {
      var imgUrl = match[1];
      if (imgUrl.startsWith("//")) imgUrl = "https:" + imgUrl;
      var imgReq = new Request(imgUrl);
      imgReq.timeoutInterval = 8;
      return await imgReq.loadImage();
    }
  } catch (e) {
    // Image fetch is best-effort; widget works without it.
  }
  return null;
}

// ────────────────────────────────────────────────────
// Local cache (FileManager)
// ────────────────────────────────────────────────────

function fm() {
  return FileManager.local();
}

function cachePath() {
  return fm().joinPath(fm().documentsDirectory(), CACHE_FILE);
}

function featuredImagePath() {
  return fm().joinPath(fm().documentsDirectory(), FEATURED_IMG);
}

function readCache() {
  var p = cachePath();
  if (!fm().fileExists(p)) return null;
  try {
    var data = JSON.parse(fm().readString(p));
    if (Date.now() - data.ts < CACHE_MINUTES * 60 * 1000) return data;
  } catch (e) {
    /* corrupt */
  }
  return null;
}

function readStaleCache() {
  var p = cachePath();
  if (!fm().fileExists(p)) return null;
  try {
    return JSON.parse(fm().readString(p));
  } catch (e) {
    return null;
  }
}

function writeCache(bookmarks, featuredId) {
  fm().writeString(
    cachePath(),
    JSON.stringify({ ts: Date.now(), bookmarks: bookmarks, featuredId: featuredId })
  );
}

function saveFeaturedImage(img) {
  if (img) fm().writeImage(featuredImagePath(), img);
}

function loadFeaturedImage() {
  var p = featuredImagePath();
  if (fm().fileExists(p)) return fm().readImage(p);
  return null;
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
// Drawing helpers
// ────────────────────────────────────────────────────

function createSeparatorImage() {
  var ctx = new DrawContext();
  ctx.size = new Size(500, 1);
  ctx.opaque = false;
  ctx.setFillColor(new Color("#ffffff", 0.2));
  ctx.fillRect(new Rect(0, 0, 500, 1));
  return ctx.getImage();
}

function createPlaceholderImage() {
  var ctx = new DrawContext();
  ctx.size = new Size(200, 120);
  ctx.opaque = false;

  // Gradient-ish solid placeholder.
  ctx.setFillColor(new Color("#2d2d5e"));
  ctx.fillRect(new Rect(0, 0, 200, 120));

  // Book icon in the centre.
  ctx.setFont(Font.regularSystemFont(36));
  ctx.setTextColor(new Color("#64ffda", 0.4));
  ctx.drawTextInRect("\u{1F4D6}", new Rect(72, 36, 60, 48));

  return ctx.getImage();
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

function createWidget(bookmarks, featured, featuredImg) {
  var count = bookmarks.length;
  var totalMin = (count * AVG_WORDS_PER_ARTICLE) / WORDS_PER_MINUTE;

  var bg     = new Color("#1a1a2e");
  var accent = new Color("#64ffda");
  var muted  = new Color("#8892b0");
  var warm   = new Color("#e6c07b");

  var w = new ListWidget();
  w.backgroundColor = bg;
  w.setPadding(12, 12, 10, 12);

  // ── Empty state ──
  if (count === 0 || !featured) {
    var hdr = w.addText("INSTAPAPER");
    hdr.font = Font.boldSystemFont(11);
    hdr.textColor = accent;
    w.addSpacer(null);
    var empty = w.addText("No unread articles");
    empty.font = Font.italicSystemFont(13);
    empty.textColor = Color.white();
    w.addSpacer(null);
    w.url = "https://www.instapaper.com";
    return w;
  }

  // ── Determine layout by widget size ──
  var family = config.widgetFamily || "small";
  var img = featuredImg || createPlaceholderImage();
  var title = featured.title || "Untitled";

  if (family === "medium" || family === "large") {
    // ── MEDIUM / LARGE: image on left, text on right ──
    var topStack = w.addStack();
    topStack.layoutHorizontally();
    topStack.spacing = 10;

    var imgEl = topStack.addImage(img);
    imgEl.imageSize = new Size(85, 85);
    imgEl.cornerRadius = 8;
    imgEl.applyFillingContentMode();

    var textStack = topStack.addStack();
    textStack.layoutVertically();
    textStack.spacing = 4;

    var brandEl = textStack.addText("INSTAPAPER");
    brandEl.font = Font.boldSystemFont(9);
    brandEl.textColor = accent;

    var titleEl = textStack.addText(title);
    titleEl.font = Font.semiboldSystemFont(14);
    titleEl.textColor = Color.white();
    titleEl.lineLimit = 3;

    if (featured.description) {
      var descEl = textStack.addText(featured.description);
      descEl.font = Font.regularSystemFont(11);
      descEl.textColor = muted;
      descEl.lineLimit = 2;
    }

    textStack.addSpacer(null);
  } else {
    // ── SMALL: image on top, title below ──
    var imgEl = w.addImage(img);
    imgEl.cornerRadius = 8;
    imgEl.applyFillingContentMode();
    imgEl.imageSize = new Size(0, 72);

    w.addSpacer(6);

    var titleEl = w.addText(title);
    titleEl.font = Font.semiboldSystemFont(12);
    titleEl.textColor = Color.white();
    titleEl.lineLimit = 2;
    titleEl.minimumScaleFactor = 0.8;
  }

  w.addSpacer(null);

  // ── Separator ──
  var sepEl = w.addImage(createSeparatorImage());
  sepEl.imageSize = new Size(0, 1);
  sepEl.imageOpacity = 1;

  w.addSpacer(6);

  // ── Stats bar ──
  var statsStack = w.addStack();
  statsStack.layoutHorizontally();
  statsStack.centerAlignContent();

  var countStr = String(count) + (count === 1 ? " article" : " articles");
  var cEl = statsStack.addText(countStr);
  cEl.font = Font.mediumSystemFont(11);
  cEl.textColor = muted;

  statsStack.addSpacer(null);

  var tEl = statsStack.addText("\u{23F1} ~" + formatTime(totalMin));
  tEl.font = Font.mediumSystemFont(11);
  tEl.textColor = warm;

  // ── Tap action → open Instapaper app ──
  w.url = "instapaper://";

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

async function loadFeaturedData(bookmarks, cachedFeaturedId) {
  if (bookmarks.length === 0) return { article: null, image: null };

  // Re-use the cached featured article when it is still in the list.
  var article;
  if (cachedFeaturedId) {
    article = bookmarks.find(function (b) {
      return String(b.bookmark_id) === String(cachedFeaturedId);
    });
  }

  if (article) {
    // Cache hit — reuse locally-stored image.
    return { article: article, image: loadFeaturedImage() };
  }

  // Pick a new random article and fetch its image.
  article = pickRandom(bookmarks);
  var img = await fetchArticleImage(article.url);
  saveFeaturedImage(img);
  return { article: article, image: img };
}

async function main() {
  // --- Running inside the Scriptable app (not as a widget) ---
  if (!config.runsInWidget) {
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

    if (hasCredentials()) {
      var cred = getCredentials();
      var bookmarks;
      try {
        bookmarks = await fetchUnreadBookmarks(cred.token, cred.secret);
      } catch (e) {
        var stale = readStaleCache();
        bookmarks = stale ? stale.bookmarks : [];
      }

      var feat = await loadFeaturedData(bookmarks, null);
      if (feat.article) writeCache(bookmarks, feat.article.bookmark_id);
      else writeCache(bookmarks, null);

      var preview = createWidget(bookmarks, feat.article, feat.image);
      preview.presentMedium();
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
  var cachedFeaturedId = null;

  var cached = readCache();
  if (cached) {
    bookmarks = cached.bookmarks;
    cachedFeaturedId = cached.featuredId;
  } else {
    try {
      bookmarks = await fetchUnreadBookmarks(cred.token, cred.secret);
    } catch (e) {
      var stale = readStaleCache();
      if (stale) {
        bookmarks = stale.bookmarks;
        cachedFeaturedId = stale.featuredId;
      } else {
        Script.setWidget(createErrorWidget("Network error"));
        Script.complete();
        return;
      }
    }
  }

  var feat = await loadFeaturedData(bookmarks, cachedFeaturedId);

  // Persist cache only when we fetched fresh data (no cachedFeaturedId from
  // a fresh cache hit means we already have valid cache).
  if (!cached) {
    writeCache(
      bookmarks,
      feat.article ? feat.article.bookmark_id : null
    );
  }

  var widget = createWidget(bookmarks, feat.article, feat.image);
  Script.setWidget(widget);
  Script.complete();
}

await main();
