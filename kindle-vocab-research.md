# Kindle Vocabulary Builder: Programmatic Access Research

## Summary

It is possible to programmatically fetch Kindle Vocabulary Builder words by accessing the `vocab.db` SQLite database stored on physical Kindle e-reader devices. There is **no official Amazon API** for this data.

---

## 1. The `vocab.db` File

Every word looked up on a Kindle e-reader is saved to a local SQLite3 database called `vocab.db`.

### File Locations

| Platform | Path |
|---|---|
| macOS (Kindle via USB) | `/Volumes/Kindle/system/vocabulary/vocab.db` |
| Windows (Kindle via USB) | `D:\system\vocabulary\vocab.db` |
| Linux (Kindle via USB) | `/media/<user>/Kindle/system/vocabulary/vocab.db` |

> The `system` folder is hidden by default. Enable hidden files or navigate directly.

### Platform Support

| Platform | Vocabulary Builder? | `vocab.db` Accessible? |
|---|---|---|
| Kindle e-reader hardware | Yes | Yes (via USB) |
| Kindle for Windows/macOS | No | No |
| Kindle for iOS/Android | No | No |
| Kindle Cloud Reader | No | No |

**Vocabulary Builder is exclusive to physical Kindle e-readers.**

---

## 2. Database Schema

### WORDS Table

```sql
CREATE TABLE WORDS (
    id         TEXT PRIMARY KEY NOT NULL,
    word       TEXT,
    stem       TEXT,
    lang       TEXT,
    category   INTEGER DEFAULT 0,  -- 0 = Learning, 100 = Mastered
    timestamp  INTEGER DEFAULT 0,
    profileid  TEXT
);
```

### LOOKUPS Table

```sql
CREATE TABLE LOOKUPS (
    id         TEXT PRIMARY KEY NOT NULL,
    word_key   TEXT,     -- FK → WORDS.id
    book_key   TEXT,     -- FK → BOOK_INFO.id
    dict_key   TEXT,     -- FK → DICT_INFO.id
    pos        TEXT,
    usage      TEXT,     -- The context sentence
    timestamp  INTEGER DEFAULT 0
);
```

### BOOK_INFO Table

```sql
CREATE TABLE BOOK_INFO (
    id      TEXT PRIMARY KEY NOT NULL,
    asin    TEXT,
    guid    TEXT,
    lang    TEXT,
    title   TEXT,
    authors TEXT
);
```

### DICT_INFO Table

```sql
CREATE TABLE DICT_INFO (
    id      TEXT PRIMARY KEY NOT NULL,
    asin    TEXT,
    langin  TEXT,
    langout TEXT
);
```

### Essential Extraction Query

```sql
SELECT
    w.word,
    w.stem,
    w.lang,
    w.category,
    l.usage AS context,
    b.title AS book_title,
    b.authors AS book_authors,
    l.timestamp
FROM LOOKUPS l
JOIN WORDS w ON l.word_key = w.id
JOIN BOOK_INFO b ON l.book_key = b.id
ORDER BY l.timestamp DESC;
```

### Aggregated Query (Multiple Lookups Per Word)

```sql
SELECT
    w.word,
    w.stem,
    group_concat(l.usage || ' (' || b.title || ')') AS usages,
    count(l.usage) AS lookup_count,
    max(l.timestamp) AS last_lookup
FROM WORDS w
LEFT JOIN LOOKUPS l ON l.word_key = w.id
LEFT JOIN BOOK_INFO b ON b.id = l.book_key
GROUP BY w.word
ORDER BY lookup_count DESC, last_lookup DESC;
```

---

## 3. What vocab.db Does NOT Contain

- **Dictionary definitions** are not stored. Only the word, context sentence, and book metadata.
- To get definitions, use an external API:
  - Free Dictionary API: https://dictionaryapi.dev/
  - Google Translate / DeepL for foreign languages
  - LLM APIs (GPT, Claude) for contextual explanations

---

## 4. Official Amazon API

**None exists.** Amazon does not expose vocabulary data through any public API. Reverse-engineered private APIs (e.g., `Xetera/kindle-api`, `transitive-bullshit/kindle-api`) focus on book metadata and reading progress — no vocabulary endpoint has been discovered.

---

## 5. Existing Open-Source Tools

### Python

| Project | Description | Link |
|---|---|---|
| kindle_vocab_anki | Extract + dictionary merge → Anki TSV | https://github.com/wzyboy/kindle_vocab_anki |
| kindle2anki (amiroslaw) | CLI with online dictionary lookup | https://github.com/amiroslaw/kindle2anki |
| kindle2anki (psamim) | AnkiConnect integration + TSV | https://github.com/psamim/kindle2anki |
| kindle-vocab (pew) | Translation via Google Translate / DeepL | https://github.com/pew/kindle-vocab |
| kindle-flashcards | GPT-powered flashcard generation | https://github.com/gustavostz/kindle-flashcards |
| KindleExtractor | Filters by book/time, Longman Dictionary | https://github.com/0xhmn/KindleExtractor |

### JavaScript/TypeScript

| Project | Description | Link |
|---|---|---|
| kindle-vocab-tools | TS library: `getAllBooks()`, `getAllLookups()` | https://github.com/stoope/kindle-vocab-tools |
| vocabulary-to-anki | Google Cloud TTS + translation | https://github.com/stoope/vocabulary-to-anki |
| Kindle2Anki (NdYAG) | Node.js, exports APKG | https://github.com/NdYAG/Kindle2Anki |

### Web-Based

| Tool | Description | Link |
|---|---|---|
| Fluentcards | Upload vocab.db, export to Anki/Memrise | https://fluentcards.com/kindle |
| KindleVocabToAnki | Web app + Google Translate | https://github.com/hebiscus/KindleVocabToAnki |

### Desktop Apps

| Tool | Description | Link |
|---|---|---|
| Kindle Mate / KMate | Full-featured, bidirectional sync, multi-format export | https://kmate.io/ |
| Kindle Companion | GUI for browsing vocab + clippings | https://saharzelo.github.io/kindle-companion/ |

### Anki Add-ons

| Tool | Description | Link |
|---|---|---|
| kind2anki | Native Anki add-on | https://ankiweb.net/shared/info/1621749993 |

### Obsidian

| Tool | Description | Link |
|---|---|---|
| Kindle Vocab plugin | Import vocab.db into Obsidian vault | https://www.obsidianstats.com/plugins/kindle-vocab |

---

## 6. Sample Python Script

```python
import sqlite3
import csv
import json
from datetime import datetime


def extract_kindle_vocab(db_path="vocab.db", output_format="csv"):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    query = """
        SELECT
            w.word, w.stem, w.lang, w.category,
            l.usage AS context,
            b.title AS book_title, b.authors AS book_authors,
            l.timestamp
        FROM LOOKUPS l
        JOIN WORDS w ON l.word_key = w.id
        JOIN BOOK_INFO b ON l.book_key = b.id
        ORDER BY l.timestamp DESC
    """

    cursor.execute(query)
    rows = cursor.fetchall()

    entries = []
    for row in rows:
        entry = {
            "word": row["word"],
            "stem": row["stem"],
            "language": row["lang"],
            "category": "mastered" if row["category"] == 100 else "learning",
            "context_sentence": row["context"],
            "book_title": row["book_title"],
            "book_authors": row["book_authors"],
            "timestamp": row["timestamp"],
            "date": datetime.fromtimestamp(
                row["timestamp"] / 1000
            ).isoformat() if row["timestamp"] else None,
        }
        entries.append(entry)

    conn.close()

    if output_format == "json":
        with open("kindle_vocab.json", "w", encoding="utf-8") as f:
            json.dump(entries, f, indent=2, ensure_ascii=False)

    elif output_format == "csv":
        with open("kindle_vocab.csv", "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=entries[0].keys())
            writer.writeheader()
            writer.writerows(entries)

    elif output_format == "tsv":
        with open("kindle_vocab.tsv", "w", newline="", encoding="utf-8") as f:
            for e in entries:
                front = e["stem"] or e["word"]
                back = f"{e['context_sentence']}<br><i>-- {e['book_title']}</i>"
                f.write(f"{front}\t{back}\n")

    print(f"Exported {len(entries)} entries to kindle_vocab.{output_format}")
    return entries


if __name__ == "__main__":
    entries = extract_kindle_vocab("vocab.db", output_format="json")
    for e in entries[:5]:
        print(f"  {e['stem']:20s} | {e['book_title']:30s} | {e['context_sentence'][:60]}...")
```

---

## 7. Alternative Data Sources

| Source | Contains Vocab? | Notes |
|---|---|---|
| `My Clippings.txt` (Kindle root) | No | Highlights/notes only, not word lookups |
| read.amazon.com/kp/notebook | No | Cloud-synced highlights, no vocabulary |
| Readwise | No | Syncs highlights, not vocab builder |
| Calibre | No | Manages books/annotations, not vocab |

---

## 8. Recommendations for Building a Flashcard App

1. **Data acquisition:** Accept `vocab.db` file upload (user connects Kindle via USB and copies the file)
2. **Extraction:** Use SQLite3 to query words, context sentences, and book info
3. **Enrichment:** Fetch definitions from a dictionary API or LLM (vocab.db doesn't store definitions)
4. **Presentation:** Build flashcard UI with spaced repetition (e.g., SM-2 algorithm)
5. **Export:** Support Anki APKG/TSV format for users who prefer Anki
6. **Limitation:** Kindle caps vocabulary builder at ~2,000 words — advise users to export periodically
7. **Limitation:** Only works with physical Kindle e-readers, not the Kindle app on phones/tablets/desktops
