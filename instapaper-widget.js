// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: orange; icon-glyph: book-open;

/**
 * Instapaper Reading Queue — Scriptable Widget
 * (Shortcuts Edition)
 *
 * Displays a random unread article (image + title). Tapping the
 * widget opens that article. A separator at the bottom shows the
 * remaining unread count and estimated total reading time.
 *
 * Data is fetched by an iOS Shortcut using Instapaper's native
 * Shortcuts actions — no API keys, no OAuth, no credentials.
 *
 * ─── SETUP ───────────────────────────────────────────
 *
 * 1. Copy this script into the Scriptable app and name it
 *    "Instapaper Widget".
 *
 * 2. Create the companion Shortcut in the iOS Shortcuts app
 *    with the following actions (in order):
 *
 *    ┌─────────────────────────────────────────────────┐
 *    │ 1. Get Instapaper Bookmarks                     │
 *    │       Folder: Unread                            │
 *    │                                                 │
 *    │ 2. Count                                        │
 *    │       Input: Instapaper Bookmarks               │
 *    │    → Save to variable "articleCount"             │
 *    │                                                 │
 *    │ 3. Get Item from List                           │
 *    │       Get: Random Item                          │
 *    │       from: Instapaper Bookmarks                │
 *    │    → Save to variable "randomArticle"           │
 *    │                                                 │
 *    │ 4. Get Name of                                  │
 *    │       Input: randomArticle                      │
 *    │    → Save to variable "articleTitle"             │
 *    │                                                 │
 *    │ 5. Get URLs from                                │
 *    │       Input: randomArticle                      │
 *    │    → Save to variable "articleURL"              │
 *    │                                                 │
 *    │ 6. Dictionary                                   │
 *    │       count  →  articleCount                    │
 *    │       title  →  articleTitle                    │
 *    │       url    →  articleURL                      │
 *    │                                                 │
 *    │ 7. Run Script (Scriptable)                      │
 *    │       Script: Instapaper Widget                 │
 *    │       Input : Dictionary                        │
 *    └─────────────────────────────────────────────────┘
 *
 * 3. (Optional) Automate it: Shortcuts → Automation →
 *    Time of Day → pick an interval → run the shortcut.
 *    This keeps the widget data fresh automatically.
 *
 * 4. Add a Small or Medium Scriptable widget to your
 *    home screen and select "Instapaper Widget".
 *
 * NOTE: "Get Instapaper Bookmarks" requires Instapaper Premium.
 * ─────────────────────────────────────────────────────
 */

// ====================== CONFIG ======================
// Average word count assumed per article (used for time estimate
// since Instapaper does not expose word counts).
const AVG_WORDS_PER_ARTICLE = 1200;

// Average adult reading speed in words per minute.
const WORDS_PER_MINUTE = 238;
// ====================================================

const CACHE_FILE   = "instapaper_data.json";
const IMAGE_FILE   = "instapaper_featured.png";

// ────────────────────────────────────────────────────
// Local cache (FileManager.local — always available,
// no iCloud download required)
// ────────────────────────────────────────────────────

function lfm() {
  return FileManager.local();
}

function cachePath() {
  return lfm().joinPath(lfm().documentsDirectory(), CACHE_FILE);
}

function imagePath() {
  return lfm().joinPath(lfm().documentsDirectory(), IMAGE_FILE);
}

function writeCache(data) {
  data.ts = Date.now();
  lfm().writeString(cachePath(), JSON.stringify(data));
}

function readCache() {
  var p = cachePath();
  if (!lfm().fileExists(p)) return null;
  try {
    return JSON.parse(lfm().readString(p));
  } catch (e) {
    return null;
  }
}

function saveFeaturedImage(img) {
  if (img) lfm().writeImage(imagePath(), img);
}

function loadFeaturedImage() {
  var p = imagePath();
  if (lfm().fileExists(p)) return lfm().readImage(p);
  return null;
}

// ────────────────────────────────────────────────────
// Article image (Open Graph)
// ────────────────────────────────────────────────────

async function fetchArticleImage(articleUrl) {
  try {
    var req = new Request(articleUrl);
    req.timeoutInterval = 8;
    var html = await req.loadString();

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
    // Best-effort; widget works fine without an image.
  }
  return null;
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
  ctx.setFillColor(new Color("#2d2d5e"));
  ctx.fillRect(new Rect(0, 0, 200, 120));
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

function createWidget(data, featuredImg) {
  var count = Number(data.count) || 0;
  var totalMin = (count * AVG_WORDS_PER_ARTICLE) / WORDS_PER_MINUTE;

  var bg     = new Color("#1a1a2e");
  var accent = new Color("#64ffda");
  var muted  = new Color("#8892b0");
  var warm   = new Color("#e6c07b");

  var w = new ListWidget();
  w.backgroundColor = bg;
  w.setPadding(12, 12, 10, 12);

  // ── Empty state ──
  if (count === 0) {
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

  var img   = featuredImg || createPlaceholderImage();
  var title = data.title || "Untitled";

  // ── Determine layout by widget size ──
  var family = config.widgetFamily || "small";

  if (family === "medium" || family === "large") {
    // ── MEDIUM / LARGE: image left, text right ──
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

  // ── Tap action → open the featured article ──
  if (data.url) w.url = data.url;

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
// Image management
// ────────────────────────────────────────────────────

async function getImage(data) {
  // Reuse the cached image if the article URL hasn't changed.
  var cached = readCache();
  if (cached && cached.url === data.url) {
    var img = loadFeaturedImage();
    if (img) return img;
  }

  // Fetch and cache the new image.
  var img = await fetchArticleImage(data.url);
  saveFeaturedImage(img);
  return img;
}

// ────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────

async function main() {
  // ── Called from the Shortcut → cache the data and exit ──
  var input = args.shortcutParameter;
  if (input && typeof input === "object") {
    writeCache({
      count: input.count,
      title: input.title,
      url:   String(input.url || ""),
    });

    // Fetch the article image while we have full runtime access.
    if (input.url) {
      var img = await fetchArticleImage(String(input.url));
      saveFeaturedImage(img);
    }

    Script.setShortcutOutput("OK");
    Script.complete();
    return;
  }

  // ── Running as a home-screen widget ──
  if (config.runsInWidget) {
    var data = readCache();
    if (!data) {
      Script.setWidget(
        createErrorWidget("Run the companion\nShortcut first")
      );
      Script.complete();
      return;
    }

    var img = loadFeaturedImage();
    // If no cached image exists, try fetching (best effort within
    // the widget's limited execution time).
    if (!img && data.url) {
      img = await fetchArticleImage(data.url);
      saveFeaturedImage(img);
    }

    Script.setWidget(createWidget(data, img));
    Script.complete();
    return;
  }

  // ── Running inside the Scriptable app → show a preview ──
  var data = readCache();
  if (!data) {
    var a = new Alert();
    a.title = "No Data Yet";
    a.message =
      "Run the companion Shortcut first so the widget " +
      "has article data to display.";
    a.addAction("OK");
    await a.presentAlert();
    return;
  }

  var img = await getImage(data);
  var widget = createWidget(data, img);
  widget.presentMedium();
}

await main();
