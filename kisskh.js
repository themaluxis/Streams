// ============================================================
// Provider Nuvio : Kisskh
// Version      : 2.0.0
// Engine       : Hermes / React Native (no async/await, no Node deps)
// Streams      : kisskh.ovh video API (kkey via Apps Script proxy)
// Subtitles    : kisskh.ovh /api/Sub (kkey via stream kkey, then Vercel
//                proxy fallback); content is AES-128-CBC encrypted per
//                SRT line, decrypted inline with a pure-JS implementation
//                and returned as data: URIs.
// ============================================================

var MAIN_URL    = "https://kisskh.ovh";
var KISSKH_API  = "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec?id=";
var SUB_PROXY   = "https://nyawit-kisskh-api-nodejs.vercel.app";
var TMDB_KEY    = "b030404650f279792a8d3287232358e3";

// Public kisskh subtitle AES-128-CBC key/IV (from player JS).
var AES_KEY = "8056483646328763";
var AES_IV  = "6852612370185273";

// ─── AES-128-CBC (pure JS, no native crypto) ─────────────────

var SBOX = [
0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];

var INV_SBOX = new Array(256);
for (var _i = 0; _i < 256; _i++) INV_SBOX[SBOX[_i]] = _i;

var RCON = [0x00,0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];

function strBytes(s) {
  var a = [];
  for (var i = 0; i < s.length; i++) a.push(s.charCodeAt(i) & 0xff);
  return a;
}

function expandKey(key) {
  var sched = key.slice();
  var i = 16;
  while (i < 176) {
    var t0 = sched[i-4], t1 = sched[i-3], t2 = sched[i-2], t3 = sched[i-1];
    if (i % 16 === 0) {
      var rc = RCON[i/16];
      var a = SBOX[t1] ^ rc, b = SBOX[t2], c = SBOX[t3], d = SBOX[t0];
      t0 = a; t1 = b; t2 = c; t3 = d;
    }
    sched[i  ] = sched[i-16] ^ t0;
    sched[i+1] = sched[i-15] ^ t1;
    sched[i+2] = sched[i-14] ^ t2;
    sched[i+3] = sched[i-13] ^ t3;
    i += 4;
  }
  return sched;
}

function gmul(a, b) {
  var p = 0;
  for (var i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    var hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}

function invShiftRows(s) {
  return [s[0],s[13],s[10],s[7],s[4],s[1],s[14],s[11],s[8],s[5],s[2],s[15],s[12],s[9],s[6],s[3]];
}

function invMixColumns(s) {
  var o = new Array(16);
  for (var c = 0; c < 4; c++) {
    var off = c*4;
    var a0 = s[off], a1 = s[off+1], a2 = s[off+2], a3 = s[off+3];
    o[off  ] = gmul(a0,0x0e) ^ gmul(a1,0x0b) ^ gmul(a2,0x0d) ^ gmul(a3,0x09);
    o[off+1] = gmul(a0,0x09) ^ gmul(a1,0x0e) ^ gmul(a2,0x0b) ^ gmul(a3,0x0d);
    o[off+2] = gmul(a0,0x0d) ^ gmul(a1,0x09) ^ gmul(a2,0x0e) ^ gmul(a3,0x0b);
    o[off+3] = gmul(a0,0x0b) ^ gmul(a1,0x0d) ^ gmul(a2,0x09) ^ gmul(a3,0x0e);
  }
  return o;
}

function decryptBlock(input, sched) {
  var s = input.slice();
  var i;
  for (i = 0; i < 16; i++) s[i] ^= sched[160+i];
  for (var r = 9; r >= 1; r--) {
    s = invShiftRows(s);
    for (i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
    for (i = 0; i < 16; i++) s[i] ^= sched[r*16+i];
    s = invMixColumns(s);
  }
  s = invShiftRows(s);
  for (i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
  for (i = 0; i < 16; i++) s[i] ^= sched[i];
  return s;
}

function aesCbcDecrypt(cipher, sched, iv) {
  var out = [];
  var prev = iv.slice();
  for (var i = 0; i < cipher.length; i += 16) {
    var blk = cipher.slice(i, i+16);
    var dec = decryptBlock(blk, sched);
    for (var j = 0; j < 16; j++) out.push(dec[j] ^ prev[j]);
    prev = blk;
  }
  var pad = out[out.length-1];
  if (pad > 0 && pad <= 16) out.length -= pad;
  return out;
}

// ─── base64 helpers (Hermes-safe) ────────────────────────────

var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var B64_DEC = (function() {
  var t = {};
  for (var i = 0; i < B64_CHARS.length; i++) t[B64_CHARS.charAt(i)] = i;
  return t;
})();

function b64Decode(s) {
  s = s.replace(/[^A-Za-z0-9+/=]/g, '').replace(/=+$/, '');
  var out = [];
  for (var i = 0; i < s.length; i += 4) {
    var c0 = B64_DEC[s.charAt(i)]   | 0;
    var c1 = B64_DEC[s.charAt(i+1)] | 0;
    var c2 = B64_DEC[s.charAt(i+2)] | 0;
    var c3 = B64_DEC[s.charAt(i+3)] | 0;
    var v = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out.push((v >> 16) & 0xff);
    if (i + 2 < s.length) out.push((v >> 8) & 0xff);
    if (i + 3 < s.length) out.push(v & 0xff);
  }
  return out;
}

function b64Encode(bytes) {
  var out = '';
  var i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    var v = (bytes[i] << 16) | (bytes[i+1] << 8) | bytes[i+2];
    out += B64_CHARS.charAt((v >> 18) & 0x3f);
    out += B64_CHARS.charAt((v >> 12) & 0x3f);
    out += B64_CHARS.charAt((v >> 6) & 0x3f);
    out += B64_CHARS.charAt(v & 0x3f);
  }
  var rem = bytes.length - i;
  if (rem === 1) {
    var v1 = bytes[i] << 16;
    out += B64_CHARS.charAt((v1 >> 18) & 0x3f);
    out += B64_CHARS.charAt((v1 >> 12) & 0x3f);
    out += '==';
  } else if (rem === 2) {
    var v2 = (bytes[i] << 16) | (bytes[i+1] << 8);
    out += B64_CHARS.charAt((v2 >> 18) & 0x3f);
    out += B64_CHARS.charAt((v2 >> 12) & 0x3f);
    out += B64_CHARS.charAt((v2 >> 6) & 0x3f);
    out += '=';
  }
  return out;
}

// ─── SRT decryption ──────────────────────────────────────────

var _aesSched = null;
function getAesSched() {
  if (!_aesSched) _aesSched = expandKey(strBytes(AES_KEY));
  return _aesSched;
}
var _aesIv = null;
function getAesIv() {
  if (!_aesIv) _aesIv = strBytes(AES_IV);
  return _aesIv;
}

// Decrypts every base64-looking line in an SRT file in place.
function decryptSrt(srt) {
  var sched = getAesSched();
  var iv = getAesIv();
  var lines = srt.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/\r$/, '');
    if (line.length < 16 || line.length % 4 !== 0) continue;
    if (!/^[A-Za-z0-9+/]+=*$/.test(line)) continue;
    try {
      var cipher = b64Decode(line);
      if (cipher.length === 0 || cipher.length % 16 !== 0) continue;
      var plainBytes = aesCbcDecrypt(cipher, sched, iv);
      // bytes → utf-8 string
      var s = '';
      var j = 0;
      while (j < plainBytes.length) {
        var b = plainBytes[j++];
        if (b < 0x80) s += String.fromCharCode(b);
        else if (b < 0xc0) { /* invalid */ }
        else if (b < 0xe0) {
          s += String.fromCharCode(((b & 0x1f) << 6) | (plainBytes[j++] & 0x3f));
        } else if (b < 0xf0) {
          var c2 = plainBytes[j++] & 0x3f;
          var c3 = plainBytes[j++] & 0x3f;
          s += String.fromCharCode(((b & 0x0f) << 12) | (c2 << 6) | c3);
        } else {
          var d2 = plainBytes[j++] & 0x3f;
          var d3 = plainBytes[j++] & 0x3f;
          var d4 = plainBytes[j++] & 0x3f;
          var cp = ((b & 0x07) << 18) | (d2 << 12) | (d3 << 6) | d4;
          var hi = 0xd800 + ((cp - 0x10000) >> 10);
          var lo = 0xdc00 + ((cp - 0x10000) & 0x3ff);
          s += String.fromCharCode(hi, lo);
        }
      }
      lines[i] = s;
    } catch (e) { /* leave the line as-is */ }
  }
  return lines.join('\n');
}

// utf-8 string → bytes (for data: URI base64)
function utf8Bytes(s) {
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6));
      out.push(0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      out.push(0xe0 | (c >> 12));
      out.push(0x80 | ((c >> 6) & 0x3f));
      out.push(0x80 | (c & 0x3f));
    } else {
      var c2 = s.charCodeAt(++i);
      var cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
      out.push(0xf0 | (cp >> 18));
      out.push(0x80 | ((cp >> 12) & 0x3f));
      out.push(0x80 | ((cp >> 6) & 0x3f));
      out.push(0x80 | (cp & 0x3f));
    }
  }
  return out;
}

// ─── Subtitle fetch (direct kisskh → Vercel proxy fallback) ──

function fetchSubList(epsId, kkey) {
  var directUrl = MAIN_URL + "/api/Sub/" + epsId + "?kkey=" + kkey;
  return fetch(directUrl, { headers: { "Referer": MAIN_URL + "/" } })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(j) { return Array.isArray(j) && j.length ? j : null; })
    .catch(function() { return null; })
    .then(function(direct) {
      if (direct) return direct;
      return fetch(SUB_PROXY + "/api/Sub/" + epsId)
        .then(function(r) { return r.json(); })
        .catch(function() { return []; });
    })
    .then(function(arr) { return Array.isArray(arr) ? arr : []; });
}

function fetchAndDecryptOne(sub) {
  return fetch(sub.src)
    .then(function(r) { return r.ok ? r.text() : null; })
    .then(function(srt) {
      if (!srt) return null;
      var plain = decryptSrt(srt);
      var dataUri = "data:application/x-subrip;base64," + b64Encode(utf8Bytes(plain));
      return {
        file: dataUri,
        url:  dataUri,
        label: sub.label || sub.land || "Sub",
        lang:  sub.land || sub.lang || "",
        language: sub.label || sub.land || ""
      };
    })
    .catch(function() { return null; });
}

function fetchSubtitles(epsId, kkey) {
  return fetchSubList(epsId, kkey).then(function(list) {
    if (!list.length) return [];
    return Promise.all(list.map(fetchAndDecryptOne))
      .then(function(arr) { return arr.filter(Boolean); });
  });
}

// ─── Main pipeline ───────────────────────────────────────────

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return new Promise(function(resolve) {
    var tmdbUrl = "https://api.themoviedb.org/3/" + mediaType + "/" + tmdbId + "?api_key=" + TMDB_KEY;

    fetch(tmdbUrl)
      .then(function(r) { return r.json(); })
      .then(function(tmdbData) {
        var title = tmdbData.title || tmdbData.name || tmdbData.original_title;
        var searchUrl = MAIN_URL + "/api/DramaList/Search?q=" + encodeURIComponent(title) + "&type=0";
        return fetch(searchUrl).then(function(r) { return r.json(); }).then(function(searchList) {
          var matched = null;
          for (var i = 0; i < searchList.length; i++) {
            if (searchList[i].title && searchList[i].title.toLowerCase() === title.toLowerCase()) {
              matched = searchList[i]; break;
            }
          }
          if (!matched && searchList.length > 0) matched = searchList[0];
          if (!matched) throw new Error("Drama not found");
          return matched.id;
        });
      })
      .then(function(dramaId) {
        return fetch(MAIN_URL + "/api/DramaList/Drama/" + dramaId + "?isq=false")
          .then(function(r) { return r.json(); })
          .then(function(detail) {
            var episodes = detail.episodes;
            if (!episodes || episodes.length === 0) throw new Error("No episodes");
            var targetEp;
            if (mediaType === "movie") {
              targetEp = episodes[episodes.length - 1];
            } else {
              for (var i = 0; i < episodes.length; i++) {
                if (parseInt(episodes[i].number, 10) === parseInt(episodeNum, 10)) {
                  targetEp = episodes[i]; break;
                }
              }
            }
            if (!targetEp) throw new Error("Episode not found");
            return targetEp.id;
          });
      })
      .then(function(epsId) {
        return fetch(KISSKH_API + epsId + "&version=2.8.10")
          .then(function(r) { return r.json(); })
          .then(function(keyData) {
            if (!keyData.key) throw new Error("No key");
            var videoApi = MAIN_URL + "/api/DramaList/Episode/" + epsId + ".png?err=false&ts=&time=&kkey=" + keyData.key;
            // Fetch streams + subtitles in parallel.
            return Promise.all([
              fetch(videoApi).then(function(r) { return r.json(); }),
              fetchSubtitles(epsId, keyData.key)
            ]);
          });
      })
      .then(function(pair) {
        var sources   = pair[0];
        var subtitles = pair[1] || [];
        console.log("[Kisskh] subtitles decrypted:", subtitles.length);

        var streams = [];
        var links = [sources.Video, sources.ThirdParty].filter(Boolean);
        links.forEach(function(link) {
          streams.push({
            name: "Kisskh",
            title: "Kisskh Stream",
            url: link,
            quality: "Auto",
            headers: { "Origin": MAIN_URL, "Referer": MAIN_URL },
            subtitles: subtitles,
            provider: "kisskh"
          });
        });

        resolve(streams);
      })
      .catch(function(err) {
        console.error("KISSKH ERROR:", err && err.message || err);
        resolve([]);
      });
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams, decryptSrt };
} else {
  global.getStreams = getStreams;
}
