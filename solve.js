// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01).
// Same build, byte for byte: a single-pass Markdown renderer with words
// counted by one regex over the body, front matter read by offset scanning
// (no split of the body), an ASCII fast path + cache for slugs, bulk
// literal-run escaping in the inline renderer, and templates compiled to
// JavaScript functions that render against a push/pop scope chain.
// Dependency-free ES module; run(input) returns the output tree.

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ------------------------------------------------------------------ text

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;
const ESC_TEST = /[&<>"']/;
function escapeHtml(text) {
  if (!ESC_TEST.test(text)) return text;
  return text.replace(ESC_RE, (c) => ESCAPES[c]);
}

const SLUG_MAX = 64;
const slugCache = new Map();
function slugify(text) {
  const hit = slugCache.get(text);
  if (hit !== undefined) return hit;
  const out = slugifySlow(text);
  if (slugCache.size < 200000) slugCache.set(text, out);
  return out;
}
function slugifySlow(text) {
  // Fast path: pure ASCII. NFKD is the identity on ASCII and ASCII holds no
  // combining marks, so the reference's normalize + \p{M} strip are no-ops.
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) { ascii = false; break; }
  }
  const plain = ascii ? text : text.normalize('NFKD').replace(/\p{M}/gu, '');
  const n = plain.length;
  const out = [];
  let gap = false;
  for (let i = 0; i < n; i++) {
    const c = plain.charCodeAt(i);
    let keep = -1;
    if (c >= 65 && c <= 90) keep = c + 32;
    else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
    if (keep === -1) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out.push('-');
    gap = false;
    out.push(String.fromCharCode(keep));
  }
  // Cut to 64 chars, dropping a '-' left at the cut (a '-' is one code unit,
  // so slicing the joined string at 64 is the same as cutting the array).
  let s = out.join('').slice(0, SLUG_MAX);
  let e = s.length;
  while (e > 0 && s.charCodeAt(e - 1) === 45) e--;
  s = s.slice(0, e);
  return s === '' ? 'untitled' : s;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function longDate(date) {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

// ------------------------------------------------------------------ front matter

const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const TAG_RE = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      if (raw.length !== 10 || raw.charCodeAt(4) !== 45 || raw.charCodeAt(7) !== 45) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      for (let i = 0; i < 10; i++) {
        if (i === 4 || i === 7) continue;
        const c = raw.charCodeAt(i);
        if (c < 48 || c > 57) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      }
      const y = Number(raw.slice(0, 4));
      const mo = Number(raw.slice(5, 7));
      const d = Number(raw.slice(8, 10));
      if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (const t of tags) {
        if (t === '' || !TAG_RE.test(t)) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout': {
      if (raw.length === 0) return { error: 'key "layout": not a template name' };
      for (let i = 0; i < raw.length; i++) {
        const c = raw.charCodeAt(i);
        if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) return { error: 'key "layout": not a template name' };
      }
      return { value: raw };
    }
    case 'slug': {
      if (raw.length === 0 || raw.length > 64) return { error: 'key "slug": not a slug' };
      for (let i = 0; i < raw.length; i++) {
        const c = raw.charCodeAt(i);
        if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) return { error: 'key "slug": not a slug' };
      }
      // /^[a-z0-9]+(?:-[a-z0-9]+)*$/: no leading/trailing '-' and no '--'.
      if (raw.charCodeAt(0) === 45 || raw.charCodeAt(raw.length - 1) === 45 || raw.includes('--')) return { error: 'key "slug": not a slug' };
      return { value: raw };
    }
    default:
      return { error: `unknown key "${key}"` };
  }
}

/**
 * A source's front matter and body, or { error } with the first reason it
 * is refused. Scans line boundaries by indexOf, so the body is never split
 * into lines: body is one slice of the text.
 */
function parseFrontMatter(text) {
  // lines[0] must be exactly '---'.
  const firstNl = text.indexOf('\n');
  const line0 = firstNl === -1 ? text : text.slice(0, firstNl);
  if (line0 !== '---') return { error: 'no front matter' };
  // Find the closing '---' line.
  let pos = firstNl === -1 ? text.length : firstNl + 1;
  let closeStart = -1;
  let closeEnd = -1;
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    if (end - pos === 3 && text.charCodeAt(pos) === 45 && text.charCodeAt(pos + 1) === 45 && text.charCodeAt(pos + 2) === 45) {
      closeStart = pos;
      closeEnd = end;
      break;
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  if (closeStart === -1) return { error: 'the front matter is not closed' };
  const data = {};
  let lineNo = 1; // 1-based, counting from the opening '---' as line 1
  pos = firstNl + 1;
  while (pos < closeStart) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? closeStart : Math.min(nl, closeStart);
    const line = text.slice(pos, end);
    lineNo++;
    if (line.length > 0 && line.charCodeAt(0) !== 35) {
      // Not blank (spaces/tabs only) and not a comment.
      let blank = true;
      for (let i = 0; i < line.length; i++) {
        const c = line.charCodeAt(i);
        if (c !== 32 && c !== 9) { blank = false; break; }
      }
      if (!blank) {
        // Manual equivalent of /^([a-z_]+):(?: (.*))?$/.
        const colon = line.indexOf(':');
        let okKey = colon > 0;
        if (okKey) {
          for (let k = 0; k < colon; k++) {
            const c = line.charCodeAt(k);
            if (!((c >= 97 && c <= 122) || c === 95)) { okKey = false; break; }
          }
        }
        if (!okKey) return { error: `line ${lineNo} is not "key: value"` };
        const key = line.slice(0, colon);
        let raw;
        if (line.length === colon + 1) raw = '';
        else if (line.charCodeAt(colon + 1) === 32) raw = line.slice(colon + 2);
        else return { error: `line ${lineNo} is not "key: value"` };
        let rEnd = raw.length;
        while (rEnd > 0) {
          const c = raw.charCodeAt(rEnd - 1);
          if (c !== 32 && c !== 9) break;
          rEnd--;
        }
        raw = raw.slice(0, rEnd);
        if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
        if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
        if (raw === '') return { error: `key "${key}" has no value` };
        const v = valueOf(key, raw);
        if ('error' in v) return v;
        data[key] = v.value;
      }
    }
    if (nl === -1 || nl >= closeStart) break;
    pos = nl + 1;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  const body = closeEnd === text.length ? '' : text.slice(closeEnd + 1);
  return { data, body };
}

// ------------------------------------------------------------------ markdown

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
const WS_RE = /\s/;
const CONTINUED_RE = /^ {2,}\S/;

/** Whether a char code is JS \s whitespace (BMP set; \s has no astral members). */
function isWS(c) {
  return c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 160 || c === 5760 ||
    (c >= 8192 && c <= 8202) || c === 8232 || c === 8233 || c === 8239 || c === 8287 || c === 12288 || c === 65279;
}

function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b) {
    const c = line.charCodeAt(a);
    if (c !== 32 && c !== 9) break;
    a++;
  }
  while (b > a) {
    const c = line.charCodeAt(b - 1);
    if (c !== 32 && c !== 9) break;
    b--;
  }
  return line.slice(a, b);
}

/** Fence-open language for a line, or null. */
function fenceLangOf(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let i = 3;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45)) break;
    i++;
  }
  const lang = line.slice(3, i);
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return null;
    i++;
  }
  return lang;
}

function isFenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Heading info for a line, or null: { depth, text }. */
function headingOf(line) {
  let hashes = 0;
  while (hashes < line.length && line.charCodeAt(hashes) === 35) hashes++;
  if (hashes === 0 || hashes > 6) return null;
  if (hashes >= line.length) return null;
  const c = line.charCodeAt(hashes);
  if (c !== 32 && c !== 9) return null;
  let a = hashes;
  while (a < line.length) {
    const d = line.charCodeAt(a);
    if (d !== 32 && d !== 9) break;
    a++;
  }
  let b = line.length;
  while (b > a) {
    const d = line.charCodeAt(b - 1);
    if (d !== 32 && d !== 9) break;
    b--;
  }
  if (b === a) return null;
  return { depth: hashes, text: line.slice(a, b) };
}

function isHr(line) {
  const c0 = line.charCodeAt(0);
  if (c0 !== 45 && c0 !== 42) return false;
  const c1 = line.charCodeAt(1);
  const c2 = line.charCodeAt(2);
  if (c0 === 45) {
    if (c1 !== 45 || c2 !== 45) return false;
  } else if (c1 !== 42 || c2 !== 42) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Whether `line` ends a paragraph: blank, fence, heading or thematic break. */
function endsParagraph(line) {
  const c0 = line.length === 0 ? -1 : line.charCodeAt(0);
  if (c0 === 96) return fenceLangOf(line) !== null;
  if (c0 === 35) return headingOf(line) !== null;
  if (c0 === 45 || c0 === 42) return isHr(line);
  if (c0 === 32 || c0 === 9 || c0 === -1) return isBlankLine(line);
  return false;
}

/**
 * First index >= from where `what` occurs outside a backslash escape, or -1.
 * Single forward scan (the reference's version rescans from `from` per hit).
 */
function findUnescaped(s, what, from) {
  const n = s.length;
  const w0 = what.charCodeAt(0);
  const wlen = what.length;
  let j = from;
  while (j <= n - wlen) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < n && ESCAPABLE.has(s[j + 1])) { j += 2; continue; }
    if (c === w0 && s.startsWith(what, j)) return j;
    j++;
  }
  return -1;
}

/** First single `*` (not part of `**`, not escaped) from `from`, or -1. */
function findSingleStar(s, from) {
  const n = s.length;
  let j = from;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < n && ESCAPABLE.has(s[j + 1])) { j += 2; continue; }
    if (c === 42) {
      if (s.charCodeAt(j + 1) === 42) { j += 2; continue; }
      return j;
    }
    j++;
  }
  return -1;
}

const MARK_RE = /[\\`*[]/g;

/**
 * `s` rendered inline. A regex finds the next markup character, so long
 * literal runs are skipped in native code; literal runs are escaped in bulk.
 * MARK_RE.lastIndex is set explicitly before every exec, so the recursion
 * below cannot corrupt an outer call's search. A markup character that
 * forms nothing stays in the literal run, exactly as the reference leaves it.
 */
function inline(s, env) {
  const n = s.length;
  let out = '';
  let i = 0;
  let lit = 0;
  for (;;) {
    MARK_RE.lastIndex = i;
    const m = MARK_RE.exec(s);
    if (m === null) break;
    const j = m.index;
    const c = s.charCodeAt(j);
    if (c === 92) {
      if (j + 1 < n && ESCAPABLE.has(s[j + 1])) {
        if (j > lit) out += escapeHtml(s.slice(lit, j));
        out += ESCAPES[s[j + 1]] ?? s[j + 1];
        i = j + 2;
        lit = i;
      } else i = j + 1;
      continue;
    }
    if (c === 96) {
      const k = s.indexOf('`', j + 1);
      if (k > j + 1) {
        if (j > lit) out += escapeHtml(s.slice(lit, j));
        out += '<code>' + escapeHtml(s.slice(j + 1, k)) + '</code>';
        i = k + 1;
        lit = i;
      } else i = j + 1;
      continue;
    }
    if (c === 42) {
      if (s.charCodeAt(j + 1) === 42) {
        const k = findUnescaped(s, '**', j + 2);
        if (k > j + 2) {
          if (j > lit) out += escapeHtml(s.slice(lit, j));
          out += '<strong>' + inline(s.slice(j + 2, k), env) + '</strong>';
          i = k + 2;
          lit = i;
        } else i = j + 2;
        continue;
      }
      const k = findSingleStar(s, j + 1);
      if (k > j + 1) {
        if (j > lit) out += escapeHtml(s.slice(lit, j));
        out += '<em>' + inline(s.slice(j + 1, k), env) + '</em>';
        i = k + 1;
        lit = i;
      } else i = j + 1;
      continue;
    }
    // c === 91 '['
    const k = findUnescaped(s, ']', j + 1);
    const mm = k !== -1 && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
    const target = mm === -1 ? '' : s.slice(k + 2, mm);
    if (target !== '' && !WS_RE.test(target)) {
      if (j > lit) out += escapeHtml(s.slice(lit, j));
      out += '<a href="' + escapeHtml(env.link(target)) + '">' + inline(s.slice(j + 1, k), env) + '</a>';
      i = mm + 1;
      lit = i;
      continue;
    }
    i = j + 1;
  }
  if (n > lit) out += escapeHtml(s.slice(lit, n));
  return out;
}

/**
 * `src` rendered: { html, toc, excerpt }. Single pass over lines, blocks
 * rendered directly into one string (no token array). Words are counted by
 * wordsOf over the body, exactly as the reference counts them.
 */
function renderMarkdown(src, env) {
  const lines = src.split('\n');
  const ids = new Set();
  const toc = [];
  let excerpt = null;
  let html = '';
  let i = 0;
  const L = lines.length;
  while (i < L) {
    const line = lines[i];
    const c0 = line.length === 0 ? -1 : line.charCodeAt(0);
    if (c0 === -1 || c0 === 32 || c0 === 9) {
      if (isBlankLine(line)) { i++; continue; }
    }
    if (c0 === 96) {
      const lang = fenceLangOf(line);
      if (lang !== null) {
        const body = [];
        i++;
        while (i < L && !isFenceClose(lines[i])) body.push(lines[i++]);
        i++;
        const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
        html += body.length === 0 ? `<pre><code${cls}></code></pre>\n` : `<pre><code${cls}>${escapeHtml(body.join('\n'))}\n</code></pre>\n`;
        continue;
      }
    }
    if (c0 === 35) {
      const heading = headingOf(line);
      if (heading !== null) {
        const id = uniqueSlug(slugify(heading.text), ids);
        const h = inline(heading.text, env);
        html += `<h${heading.depth} id="${id}">${h}</h${heading.depth}>\n`;
        if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html: h });
        i++;
        continue;
      }
    }
    if (c0 === 45 || c0 === 42) {
      if (isHr(line)) {
        html += '<hr>\n';
        i++;
        continue;
      }
    }
    if (c0 === 62) {
      const body = [];
      while (i < L && lines[i].charCodeAt(0) === 62) {
        const l = lines[i++];
        body.push(l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1));
      }
      const kept = [];
      for (const l of body) {
        const t = trimLine(l);
        if (t !== '') kept.push(t);
      }
      html += kept.length === 0 ? '<blockquote>\n</blockquote>\n' : `<blockquote>\n<p>${inline(kept.join('\n'), env)}</p>\n</blockquote>\n`;
      continue;
    }
    const isBullet = (c0 === 45 || c0 === 42) && line.charCodeAt(1) === 32;
    let orderedStart = -1;
    if (!isBullet && c0 >= 48 && c0 <= 57) {
      let d = 0;
      while (d < 9 && d < line.length && line.charCodeAt(d) >= 48 && line.charCodeAt(d) <= 57) d++;
      if (d >= 1 && d < line.length && line.charCodeAt(d) === 46 && line.charCodeAt(d + 1) === 32) orderedStart = Number(line.slice(0, d));
    }
    if (isBullet || orderedStart !== -1) {
      const isOrdered = orderedStart !== -1;
      const items = [];
      while (i < L) {
        const l = lines[i];
        if (isOrdered) {
          let d = 0;
          while (d < 9 && d < l.length && l.charCodeAt(d) >= 48 && l.charCodeAt(d) <= 57) d++;
          if (d >= 1 && d < l.length && l.charCodeAt(d) === 46 && l.charCodeAt(d + 1) === 32) {
            items.push([trimLine(l.slice(d + 2))]);
            i++;
            continue;
          }
        } else {
          const b0 = l.charCodeAt(0);
          if ((b0 === 45 || b0 === 42) && l.charCodeAt(1) === 32) {
            items.push([trimLine(l.slice(2))]);
            i++;
            continue;
          }
        }
        if (items.length > 0 && CONTINUED_RE.test(l)) {
          items[items.length - 1].push(trimLine(l));
          i++;
          continue;
        }
        break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && orderedStart !== 1 ? `<ol start="${orderedStart}">` : `<${tag}>`;
      let inner = '';
      for (const parts of items) inner += `<li>${inline(parts.join('\n'), env)}</li>\n`;
      html += `${open}\n${inner}</${tag}>\n`;
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < L && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const p = inline(body.join('\n'), env);
    if (excerpt === null) excerpt = p;
    html += `<p>${p}</p>\n`;
  }
  return { html, toc, excerpt: excerpt ?? '' };
}

// ------------------------------------------------------------------ templates

const INCLUDE_DEPTH = 8;
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

/** A value as text: string itself, a number in JS digits, true/false, an array's items joined by ", ", else "". */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

/** A value's text, HTML-escaped (a string skips textOf). */
function vesc(v) {
  return typeof v === 'string' ? escapeHtml(v) : escapeHtml(textOf(v));
}
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** First name of a path from the nearest scope frame holding it. */
function lk1(sc, a) {
  const top = sc[sc.length - 1];
  if (Object.hasOwn(top, a)) return top[a];
  for (let d = sc.length - 2; d >= 0; d--) {
    const v = sc[d];
    if (Object.hasOwn(v, a)) return v[a];
  }
  return undefined;
}
function lkN(sc, a, rest) {
  let v = lk1(sc, a);
  for (let k = 0; k < rest.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, rest[k])) return undefined;
    v = v[rest[k]];
  }
  return v;
}

/** Tree-walking renderer, fallback if codegen is unavailable. */
function renderNodes(nodes, scope, ctx, depth) {
  let out = '';
  for (const n of nodes) {
    switch (n.kind) {
      case 'text': out += n.text; break;
      case 'var': out += vesc(lkN(scope, n.path[0], n.path.slice(1))); break;
      case 'raw': out += textOf(lkN(scope, n.path[0], n.path.slice(1))); break;
      case 'if': {
        const v = truthy(lkN(scope, n.path[0], n.path.slice(1)));
        const branch = v !== n.not ? n.then : n.else;
        if (branch !== null) out += renderNodes(branch, scope, ctx, depth);
        break;
      }
      case 'for': {
        const xs = lkN(scope, n.path[0], n.path.slice(1));
        if (!Array.isArray(xs)) break;
        for (let k = 0; k < xs.length; k++) {
          scope.push({ [n.name]: xs[k], loop: { index: k + 1, first: k === 0, last: k === xs.length - 1, length: xs.length } });
          out += renderNodes(n.body, scope, ctx, depth);
          scope.pop();
        }
        break;
      }
      case 'include': {
        const t = ctx.templates.get(n.name);
        if (t !== undefined && depth < INCLUDE_DEPTH) out += renderNodes(t, scope, ctx, depth + 1);
        break;
      }
    }
  }
  return out;
}

/** Compile a parsed template body to a fast render function. */
function compileTemplate(nodes) {
  let uid = 0;
  const gen = (ns, ind) => {
    let code = '';
    for (const n of ns) {
      if (n.kind === 'text') {
        code += `${ind}out += ${JSON.stringify(n.text)};\n`;
      } else if (n.kind === 'var' || n.kind === 'raw') {
        const p = n.path;
        const lk = p.length === 1 ? `lk1(sc, ${JSON.stringify(p[0])})` : `lkN(sc, ${JSON.stringify(p[0])}, ${JSON.stringify(p.slice(1))})`;
        code += n.kind === 'var'
          ? `${ind}out += vesc(${lk});\n`
          : `${ind}out += textOf(${lk});\n`;
      } else if (n.kind === 'if') {
        const p = n.path;
        const lk = p.length === 1 ? `lk1(sc, ${JSON.stringify(p[0])})` : `lkN(sc, ${JSON.stringify(p[0])}, ${JSON.stringify(p.slice(1))})`;
        code += `${ind}if (truthy(${lk}) !== ${n.not}) {\n${gen(n.then, ind + '  ')}${ind}}`;
        if (n.else !== null) code += ` else {\n${gen(n.else, ind + '  ')}${ind}}`;
        code += '\n';
      } else if (n.kind === 'for') {
        const p = n.path;
        const lk = p.length === 1 ? `lk1(sc, ${JSON.stringify(p[0])})` : `lkN(sc, ${JSON.stringify(p[0])}, ${JSON.stringify(p.slice(1))})`;
        const u = uid++;
        code += `${ind}{ const _xs${u} = ${lk};\n`;
        code += `${ind}  if (Array.isArray(_xs${u})) for (let _k${u} = 0; _k${u} < _xs${u}.length; _k${u}++) {\n`;
        code += `${ind}    sc.push({ ${JSON.stringify(n.name)}: _xs${u}[_k${u}], loop: { index: _k${u} + 1, first: _k${u} === 0, last: _k${u} === _xs${u}.length - 1, length: _xs${u}.length } });\n`;
        code += gen(n.body, ind + '    ');
        code += `${ind}    sc.pop();\n${ind}  }\n${ind}}\n`;
      } else if (n.kind === 'include') {
        code += `${ind}{ const _t = ctx.templates.get(${JSON.stringify(n.name)});\n`;
        code += `${ind}  if (_t !== undefined && depth < ${INCLUDE_DEPTH}) out += _t(sc, ctx, depth + 1);\n${ind}}\n`;
      }
    }
    return code;
  };
  const body = gen(nodes, '  ');
  const src = `return function render(sc, ctx, depth) {\n  let out = '';\n${body}  return out;\n};`;
  return new Function('lk1', 'lkN', 'textOf', 'truthy', 'vesc', src)(lk1, lkN, textOf, truthy, vesc);
}

// ------------------------------------------------------------------ build

export const REPORT_FILE = 'build-report.txt';
export const RESERVED = Object.freeze(['posts', 'tags', 'page']);

function wordsOf(text) {
  // One manual pass, no allocation (match(/\S+/g) builds an array of every word).
  let n = 0;
  let w = false;
  for (let i = 0; i < text.length; i++) {
    if (isWS(text.charCodeAt(i))) w = false;
    else if (!w) { w = true; n++; }
  }
  return n;
}

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function readSources(b) {
  const files = [...b.input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  for (const f of files) {
    if (f.path.endsWith('.md')) b.sources.push({ path: f.path, text: f.content.includes('\r') ? f.content.replace(/\r\n?/g, '\n') : f.content });
    else b.statics.push({ path: f.path, content: f.content });
  }
}

function frontMatter(b) {
  const kept = [];
  for (const s of b.sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      b.report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
    if (own !== undefined) {
      b.report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      b.report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!b.templates.has(layout)) {
      b.report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      b.report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  b.sources = kept;
}

function permalinks(b) {
  const taken = new Map();
  const takenIn = (dir) => {
    if (!taken.has(dir)) taken.set(dir, new Set(dir === '' ? RESERVED : []));
    return taken.get(dir);
  };
  for (const s of b.sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), takenIn(dir));
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${b.base}/${s.outDir}/`;
    b.bySource.set(s.path, s);
  }
}

function markdown(b) {
  const staticPaths = new Set(b.statics.map((f) => f.path));
  for (const s of b.sources) {
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        if (hasScheme(target) || target.charCodeAt(0) === 47 || target.charCodeAt(0) === 35) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null && b.bySource.has(path)) return `${b.bySource.get(path).url}${frag}`;
        if (path !== null && staticPaths.has(path)) return `${b.base}/${path}${frag}`;
        b.broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
    s.words = wordsOf(s.body);
  }
}

/** /^[A-Za-z][A-Za-z0-9+.-]*:/, manual: a scheme must precede any other char. */
function hasScheme(target) {
  const c0 = target.charCodeAt(0);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return false;
  for (let i = 1; i < target.length; i++) {
    const c = target.charCodeAt(i);
    if (c === 58) return true;
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46)) return false;
  }
  return false;
}

function collections(b) {
  const posts = b.sources.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  b.posts = posts;
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });
}

function tags(b) {
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const sl = slugify(name);
      if (seen.has(sl)) continue;
      seen.add(sl);
      out.push(name);
    }
    return out;
  };
  for (const p of b.posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      if (!bySlug.has(slug)) bySlug.set(slug, { name, slug, url: `${b.base}/tags/${slug}/`, posts: [] });
      const tag = bySlug.get(slug);
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of b.sources) if (!s.post) s.tagRefs = ownTags(s).map((name) => bySlug.get(slugify(name)) ?? { name, slug: slugify(name), url: '', posts: [] });
  b.tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));
}

const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });
const tagOf = (b, t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => p.card) });

function cardOf(s) {
  return {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(s.words / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  };
}

function pageOf(s) {
  const card = s.post ? s.card : cardOf(s);
  return {
    title: card.title,
    url: card.url,
    date: card.date,
    date_long: card.date_long,
    summary: card.summary,
    excerpt: card.excerpt,
    reading_minutes: card.reading_minutes,
    tags: card.tags,
    slug: s.slug,
    content: s.html,
    toc: s.toc,
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  };
}

function layouts(b) {
  for (const p of b.posts) p.card = cardOf(p);
  const site = { title: b.input.site.title, base_url: b.base };
  const allTags = b.tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = b.posts.slice(0, b.input.site.recent).map((p) => p.card);
  const ctx = { templates: b.templates };
  const render = (name, vars) => {
    const fn = b.templates.get(name);
    return fn === undefined ? null : fn([{ site, tags: allTags, recent, ...vars }], ctx, 0);
  };
  let pageCount = 0;
  for (const s of b.sources) {
    if (!s.post) pageCount++;
    b.output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  }
  b.pageCount = pageCount;
  const per = b.input.site.per_page;
  const pages = Math.max(1, Math.ceil(b.posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${b.base}/` : `${b.base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: b.posts.slice((k - 1) * per, k * per).map((p) => p.card),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) b.output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of b.tags) {
    const html = render('tag', { tag: tagOf(b, t) });
    if (html !== null) b.output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) b.output['tags/index.html'] = tagsHtml;
  for (const f of b.statics) {
    if (Object.hasOwn(b.output, f.path)) b.report.push(`shadowed ${f.path}: a built page has its path`);
    else b.output[f.path] = f.content;
  }
}

function report(b) {
  const lines = [...b.report, ...b.broken].sort(byCodeUnits);
  lines.push(`built ${b.pageCount} pages, ${b.posts.length} posts, ${b.tags.length} tags and ${b.statics.length} static files`);
  b.output[REPORT_FILE] = `${lines.join('\n')}\n`;
}

const PIPELINE = [readSources, frontMatter, permalinks, markdown, collections, tags, layouts, report];

/** One site's output tree: path -> text. */
export function build(input) {
  const templates = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      const nodes = parseTemplate(name, input.templates[name]);
      let fn;
      try {
        fn = compileTemplate(nodes);
      } catch {
        fn = (sc, ctx, depth) => renderNodes(nodes, sc, ctx, depth);
      }
      templates.set(name, fn);
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const b = {
    input,
    base: input.site.base_url.replace(/\/+$/, ''),
    templates,
    sources: [],
    statics: [],
    bySource: new Map(),
    broken: new Set(),
    report,
    posts: [],
    tags: [],
    output: {},
    pageCount: 0,
  };
  for (const plugin of PIPELINE) plugin(b);
  return b.output;
}

export function run(input) {
  return build(input);
}
