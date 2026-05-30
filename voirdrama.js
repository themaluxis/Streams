// ============================================================
// Provider Nuvio : VoirDrama (voirdrama.to)
// Version      : 2.1.0 (Updated with IMDb Support)
// Moteur       : Promise chains UNIQUEMENT (Hermes / React Native)
//                AUCUN async/await, AUCUN require() Node.js
//                AUCUN regex flag /s (incompat Hermes < 0.12)
// Langues      : VF priorité, fallback VOSTFR
// Sources      : VIDM (vidmoly.biz) > Mail.ru > autres
// ============================================================

var VD_BASE      = 'https://voirdrama.to';
var VD_REF       = VD_BASE + '/';
var UA           = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var TMDB_KEY     = '2dca580c2a14b55200e784d157207b4d';

// Cache mémoire tmdbId → slug voirdrama
var _cache = {};

// ─── Helpers réseau ──────────────────────────────────────────

function getText(url, referer) {
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      'Referer': referer || VD_REF,
      'Accept-Language': 'fr-FR,fr;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + url);
    return r.text();
  });
}

function getJson(url) {
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  }).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

// ─── Étape 0 : Conversion IMDb → TMDB ─────────────────────────

function resolveToTmdbId(id) {
  // Si c'est déjà un ID TMDB (uniquement des chiffres)
  if (/^\d+$/.test(id)) {
    return Promise.resolve(id);
  }

  // Si c'est un ID IMDb (commence par "tt" suivi de chiffres)
  if (/^tt\d+$/.test(id)) {
    var url = 'https://api.themoviedb.org/3/find/' + id + '?api_key=' + TMDB_KEY + '&external_source=imdb_id';
    console.log('[VoirDrama] Conversion IMDb -> TMDB:', url);
    
    return getJson(url).then(function(d) {
      // Cherche dans les résultats films, puis séries
      var results = d.movie_results || [];
      if (!results.length) results = d.tv_results || [];
      
      if (!results.length) {
        throw new Error('Aucun équivalent TMDB trouvé pour l\'IMDb ID: ' + id);
      }
      
      var tmdbId = results[0].id.toString();
      console.log('[VoirDrama] IMDb (' + id + ') résolu en TMDB (' + tmdbId + ')');
      return tmdbId;
    });
  }

  return Promise.reject(new Error('Format d\'ID non reconnu: ' + id));
}

// ─── Étape 1 : tmdbId → titres candidats ─────────────────────

function getTitlesFromTmdb(tmdbId, mediaType) {
  var type = (mediaType === 'movie') ? 'movie' : 'tv';
  var url  = 'https://api.themoviedb.org/3/' + type + '/' + tmdbId
    + '?api_key=' + TMDB_KEY + '&language=fr-FR&append_to_response=alternative_titles';

  console.log('[VoirDrama] TMDB:', url);

  return getJson(url).then(function(d) {
    var seen = {}, titles = [];

    function add(t) {
      t = (t || '').trim();
      if (t && !seen[t]) { seen[t] = 1; titles.push(t); }
    }

    var frFull    = (d.name || d.title || '').trim();
    var frShort   = frFull.split(/\s*[:\-|]\s*/)[0].trim();
    var orig      = (d.original_name || d.original_title || '').trim();
    var origShort = orig.split(/\s*[:\-|]\s*/)[0].trim();

    // Court en premier : slugs voirdrama = titres courts (ex: "hidden-love")
    add(frShort);
    add(frFull);
    add(origShort);
    add(orig);

    var arr = ((d.alternative_titles || {}).results || (d.alternative_titles || {}).titles || []);
    arr.forEach(function(a) {
      var t = (a.title || a.name || '').trim();
      add(t.split(/\s*[:\-|]\s*/)[0].trim());
      add(t);
    });

    console.log('[VoirDrama] Titres candidats:', titles.slice(0, 6));
    return titles;
  }).catch(function(e) {
    console.warn('[VoirDrama] TMDB fail:', e.message);
    return [];
  });
}

// ─── Étape 2 : Recherche slug ─────────────────────────────────
// VoirDrama = WordPress Madara
// URL de recherche : /?s={query}&post_type=wp-manga
// Les résultats contiennent des liens /drama/{slug}/

function searchVoirDrama(query) {
  if (!query || query.length < 2) return Promise.resolve([]);

  var url = VD_BASE + '/?s=' + encodeURIComponent(query) + '&post_type=wp-manga';
  console.log('[VoirDrama] Recherche:', url);

  return getText(url, VD_REF)
    .then(function(html) {
      var results = [];
      var re = /href=["']https?:\/\/[^"'\/]+\/drama\/([a-z0-9_-]+)\/?["']/gi;
      var m;
      while ((m = re.exec(html)) !== null) {
        if (results.indexOf(m[1]) === -1) results.push(m[1]);
      }
      console.log('[VoirDrama] Slugs pour "' + query + '":', results);
      return results;
    })
    .catch(function(e) {
      console.warn('[VoirDrama] Search fail "' + query + '":', e.message);
      return [];
    });
}

// ─── Étape 2b : Score similarité ─────────────────────────────

function norm(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function scoreMatch(title, slug) {
  var a = norm(title);
  var b = norm(slug.replace(/-/g, ' '));
  if (a === b) return 1;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return 0.9;
  var wa = a.split(' '), wb = b.split(' ');
  var common = wa.filter(function(w) { return w.length > 2 && wb.indexOf(w) !== -1; });
  return common.length / Math.max(wa.length, wb.length, 1);
}

// ─── Étape 2c : Résolution slug ──────────────────────────────

function resolveSlug(tmdbId, titles) {
  if (_cache[tmdbId]) {
    console.log('[VoirDrama] Cache hit:', _cache[tmdbId]);
    return Promise.resolve(_cache[tmdbId]);
  }

  var best = null, bestScore = 0;

  return titles.reduce(function(chain, title) {
    return chain.then(function() {
      if (bestScore >= 1) return;
      return searchVoirDrama(title).then(function(slugs) {
        slugs.forEach(function(slug) {
          var s = scoreMatch(title, slug);
          if (s > bestScore) { bestScore = s; best = slug; }
        });
      });
    });
  }, Promise.resolve()).then(function() {
    if (best) {
      console.log('[VoirDrama] Slug résolu:', best, '(score', bestScore.toFixed(2) + ')');
      _cache[tmdbId] = best;
    } else {
      console.warn('[VoirDrama] Slug introuvable pour tmdbId=' + tmdbId);
    }
    return best;
  });
}

// ─── Étape 3 : Récupération page épisode ─────────────────────

function padEp(n) {
  if (n < 10) return '0' + n;
  return '' + n;
}

function fetchEpisodePage(slug, season, episode) {
  var dramaUrl = VD_BASE + '/drama/' + slug + '/';

  return getText(dramaUrl, VD_REF)
    .then(function(html) {
      return parseEpisodeList(html, slug, season, episode);
    })
    .then(function(episodeUrl) {
      if (!episodeUrl) throw new Error('URL épisode introuvable dans la page drama');
      console.log('[VoirDrama] URL épisode:', episodeUrl);
      return getText(episodeUrl, VD_REF).then(function(html) {
        return { html: html, url: episodeUrl };
      });
    })
    .catch(function(err) {
      console.warn('[VoirDrama] Fallback URL directe:', err.message);
      return buildDirectEpisodeUrl(slug, season, episode);
    });
}

function parseEpisodeList(html, slug, season, episode) {
  var langOrder = ['vf', 'vostfr'];
  var results   = {}; 

  var reA = /href=["'](https?:\/\/[^"']+\/drama\/[^"'\/]+\/([^"'\/]+))\/?["']/gi;
  var reOpt = /data-redirect=["'](https?:\/\/[^"']+\/drama\/[^"'\/]+\/([^"'\/]+))\/?["']/gi;

  function processMatch(m) {
    var fullUrl = m[1];
    var epSlug  = m[2].toLowerCase(); 

    if (fullUrl.indexOf('/drama/' + slug + '/') === -1) return;

    var epMatch = epSlug.match(/-(\d+)-(vf|vostfr)/);
    if (!epMatch) return;

    var epNum = parseInt(epMatch[1], 10);
    var lang  = epMatch[2];

    if (!results[lang]) results[lang] = {};
    if (!results[lang][epNum]) results[lang][epNum] = fullUrl;
  }

  var m;
  while ((m = reA.exec(html)) !== null) processMatch(m);
  while ((m = reOpt.exec(html)) !== null) processMatch(m);

  console.log('[VoirDrama] Épisodes extraits -> VF:', Object.keys(results['vf'] || {}).length, 
              '| VOSTFR:', Object.keys(results['vostfr'] || {}).length);

  for (var i = 0; i < langOrder.length; i++) {
    var lang2 = langOrder[i];
    if (results[lang2] && results[lang2][episode]) {
      console.log('[VoirDrama] Épisode', episode, 'trouvé en', lang2.toUpperCase());
      return Promise.resolve(results[lang2][episode]);
    }
  }

  return Promise.resolve(null);
}

function buildDirectEpisodeUrl(slug, season, episode) {
  var ep = padEp(episode);
  var langs   = ['vf', 'vostfr'];
  var found   = null;

  return langs.reduce(function(chain, lang) {
    return chain.then(function() {
      if (found) return;
      var url = VD_BASE + '/drama/' + slug + '/' + slug + '-' + ep + '-' + lang + '/';
      return fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': UA, 'Referer': VD_REF }
      })
      .then(function(r) {
        if (r.ok && r.url.indexOf(ep + '-' + lang) !== -1) {
          console.log('[VoirDrama] URL directe OK:', r.url);
          found = r.url;
        }
      })
      .catch(function() {});
    });
  }, Promise.resolve())
  .then(function() {
    if (!found) throw new Error('Aucune URL directe valide pour S' + season + 'E' + episode);
    return getText(found, VD_REF).then(function(html) {
      return { html: html, url: found };
    });
  });
}

// ─── Étape 4 : Extraction des sources depuis la page épisode ─

function parseChapterSources(html) {
  var re = /var\s+thisChapterSources\s*=\s*(\{[\s\S]*?\})\s*;/;
  var m  = re.exec(html);
  if (!m) {
    console.warn('[VoirDrama] thisChapterSources non trouvé');
    return [];
  }

  var rawJson = m[1];
  rawJson = rawJson.replace(/\\u([0-9a-fA-F]{4})/g, function(_, hex) {
    return String.fromCharCode(parseInt(hex, 16));
  });

  var sources;
  try {
    sources = JSON.parse(rawJson);
  } catch (e) {
    console.warn('[VoirDrama] JSON.parse thisChapterSources échoué:', e.message);
    sources = {};
    var fallbackRe = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    var fm;
    while ((fm = fallbackRe.exec(rawJson)) !== null) {
      sources[fm[1]] = fm[2].replace(/\\"/g, '"').replace(/\\\//g, '/');
    }
  }

  var result = [];
  Object.keys(sources).forEach(function(label) {
    var iframeHtml = sources[label] || '';
    var srcM = /src=["']([^"']+)["']/.exec(iframeHtml);
    if (srcM && srcM[1].indexOf('http') === 0) {
      result.push({ label: label, url: srcM[1] });
      console.log('[VoirDrama] Source:', label, '→', srcM[1].substring(0, 70));
    }
  });

  result.sort(function(a, b) {
    var aIsVidm = a.label.toUpperCase().indexOf('VIDM') !== -1 ? 1 : 0;
    var bIsVidm = b.label.toUpperCase().indexOf('VIDM') !== -1 ? 1 : 0;
    return bIsVidm - aIsVidm;
  });

  return result;
}

function detectLangFromUrl(url) {
  var u = url.toLowerCase();
  if (/-vf\//.test(u) || /-vf$/.test(u)) return 'vf';
  return 'vostfr';
}

// ─── Étape 5 : Extracteurs embed ─────────────────────────────

function unpackEval(code) {
  try {
    if (code.indexOf('p,a,c,k,e,d') === -1) return code;
    var re = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)[\s\S]*?\}\s*\(([\s\S]*?)\)\s*\)/g;
    var m = re.exec(code);
    if (!m) return code;
    var args = m[1].match(/^'([\s\S]*?)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/);
    if (!args) return code;
    var payload = args[1].replace(/\\'/g, "'");
    var base = parseInt(args[2]), count = parseInt(args[3]);
    var words = args[4].split('|');
    var toBase = function(n) {
      return (n < base ? '' : toBase(Math.floor(n / base))) + ((n = n % base) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
    };
    var dict = {};
    while (count--) dict[toBase(count)] = words[count] || toBase(count);
    return payload.replace(/\b\w+\b/g, function(w) { return dict[w] || w; });
  } catch (e) { return code; }
}

function extractVidmoly(embedUrl) {
  var ref = 'https://' + embedUrl.replace(/^https?:\/\//, '').split('/')[0] + '/';

  return fetch(embedUrl, {
    headers: {
      'User-Agent': UA,
      'Referer': VD_REF,
      'Origin': VD_BASE
    }
  })
  .then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  })
  .then(function(html) {
    var redir = /window\.location\.(?:replace|href)\s*=\s*['"]([^'"]+)['"]/.exec(html);
    if (redir && redir[1] !== embedUrl) {
      return fetch(redir[1], {
        headers: { 'User-Agent': UA, 'Referer': ref }
      }).then(function(r2) { return r2.text(); });
    }
    return html;
  })
  .then(function(html) {
    if (html.indexOf('p,a,c,k,e,d') !== -1) html = unpackEval(html);

    var m3 = /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i.exec(html)
          || /["'](https?:\/\/[^"']+\.m3u8[^"'"\s]*)["']/i.exec(html)
          || /<source[^>]+src=["']([^"']+\.m3u8[^"']*)["']/i.exec(html);
    if (m3) return { url: m3[1], fmt: 'm3u8', referer: ref };

    var m4 = /file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i.exec(html)
          || /["'](https?:\/\/[^"']+\.mp4[^"'"\s]*)["']/i.exec(html);
    if (m4) return { url: m4[1], fmt: 'mp4', referer: ref };

    return null;
  })
  .catch(function(e) {
    console.warn('[VoirDrama][Vidmoly] Erreur:', e.message);
    return null;
  });
}

function extractMailRu(embedUrl) {
  return fetch(embedUrl, {
    headers: {
      'User-Agent': UA,
      'Referer': VD_REF
    }
  })
  .then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  })
  .then(function(html) {
    var dataM = /data-vars=["']([^"']+)["']/.exec(html);
    if (dataM) {
      try {
        var decoded = decodeURIComponent(dataM[1]);
        var data = JSON.parse(decoded);
        var videos = (data && data.videos) || [];
        if (videos.length) {
          var best = videos[videos.length - 1];
          return { url: best.url, fmt: best.url.indexOf('.m3u8') !== -1 ? 'm3u8' : 'mp4', referer: 'https://my.mail.ru/' };
        }
      } catch (e) { /* ignore */ }
    }

    var m3 = /["'](https?:\/\/[^"']+\.m3u8[^"'"\s]*)["']/i.exec(html);
    if (m3) return { url: m3[1], fmt: 'm3u8', referer: 'https://my.mail.ru/' };

    var m4 = /["'](https?:\/\/[^"']+\.mp4[^"'"\s]*)["']/i.exec(html);
    if (m4) return { url: m4[1], fmt: 'mp4', referer: 'https://my.mail.ru/' };

    return null;
  })
  .catch(function(e) {
    console.warn('[VoirDrama][MailRu] Erreur:', e.message);
    return null;
  });
}

function extractSibnet(shellUrl) {
  return fetch(shellUrl, {
    headers: { 'User-Agent': UA, 'Referer': 'https://video.sibnet.ru/' }
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var m = /src\s*:\s*['"](\/v\/[^'"]+\.mp4)['"]/.exec(html)
         || /file\s*:\s*["'](\/v\/[^'"]+\.mp4)["']/.exec(html)
         || /["']((?:https?:)?\/\/[^"'\s]+\.mp4[^"'\s]*)["']/.exec(html);
    if (!m) return null;
    var path = m[1];
    if (path.indexOf('//') === 0) return { url: 'https:' + path, fmt: 'mp4', referer: 'https://video.sibnet.ru/' };
    if (path.charAt(0) === '/')   return { url: 'https://video.sibnet.ru' + path, fmt: 'mp4', referer: 'https://video.sibnet.ru/' };
    return { url: path, fmt: 'mp4', referer: 'https://video.sibnet.ru/' };
  })
  .catch(function() { return null; });
}

function extractSendvid(embedUrl) {
  var url = embedUrl.indexOf('/embed/') !== -1
    ? embedUrl
    : embedUrl.replace(/sendvid\.com\/([a-z0-9]+)/i, 'sendvid.com/embed/$1');

  return fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': 'https://sendvid.com/' }
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var patterns = [
      /video_source\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
      /["'](https?:\/\/videos\d*\.sendvid\.com\/[^"'>\s]+\.mp4[^"'>\s]*)["']/i,
      /<source[^>]+src=["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i,
      /file\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i,
      /["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = patterns[i].exec(html);
      if (m) return { url: m[1], fmt: 'mp4', referer: 'https://sendvid.com/' };
    }
    return null;
  })
  .catch(function() { return null; });
}

function classifySource(url) {
  var u = (url || '').toLowerCase();
  if (/vidmoly\.(biz|to|me|net|ru|is)/.test(u)) return 'vidmoly'; 
  if (/my\.mail\.ru/.test(u))                    return 'mailru';
  if (/sibnet\.ru/.test(u))                      return 'sibnet';
  if (/sendvid\.com/.test(u))                    return 'sendvid';
  return 'unknown';
}

function extractUrl(embedUrl) {
  var type = classifySource(embedUrl);
  console.log('[VoirDrama] Extracteur:', type, '—', embedUrl.substring(0, 80));

  switch (type) {
    case 'vidmoly':  return extractVidmoly(embedUrl);
    case 'mailru':   return extractMailRu(embedUrl);
    case 'sibnet':   return extractSibnet(embedUrl);
    case 'sendvid':  return extractSendvid(embedUrl);
    default:
      return Promise.resolve(null);
  }
}

// ─── Étape 6 : Priorités et construction des streams ─────────

var PRIO = {
  vidmoly:  100,
  mailru:    60,
  sibnet:    50,
  sendvid:   55,
  unknown:   20
};

var LABELS = {
  vidmoly: 'VIDM',
  mailru:  'Mail.ru',
  sibnet:  'Sibnet',
  sendvid: 'Sendvid'
};

function buildStreams(sources, lang, season, episode) {
  var flag = (lang === 'vf') ? '[VF]' : '[VOSTFR]';

  var promises = sources.map(function(source) {
    var type = classifySource(source.url);
    var labelBoost = source.label.toUpperCase().indexOf('VIDM') !== -1 ? 10 : 0;

    return extractUrl(source.url).then(function(res) {
      if (!res || !res.url) return null;
      return {
        name:    'VoirDrama',
        title:   flag + ' ' + (LABELS[type] || source.label) + ' | S' + season + 'E' + episode,
        url:     res.url,
        quality: res.fmt === 'm3u8' ? 'HD' : 'Auto',
        format:  res.fmt,
        headers: {
          'User-Agent': UA,
          'Referer': res.referer || VD_REF
        },
        _prio: (PRIO[type] || 20) + labelBoost
      };
    }).catch(function() { return null; });
  });

  return Promise.all(promises).then(function(results) {
    return results
      .filter(Boolean)
      .sort(function(a, b) { return b._prio - a._prio; })
      .map(function(r) { delete r._prio; return r; });
  });
}

// ─── Interface publique Nuvio ─────────────────────────────────

function getStreams(providedId, mediaType, season, episode) {
  var s = season  || 1;
  var e = episode || 1;

  console.log('[VoirDrama] getStreams ID=' + providedId + ' type=' + mediaType + ' S' + s + 'E' + e);

  function pipeline() {
    var resolvedTmdbId;

    return resolveToTmdbId(providedId)
      .then(function(tmdbId) {
        resolvedTmdbId = tmdbId; 
        return getTitlesFromTmdb(resolvedTmdbId, mediaType);
      })
      .then(function(titles) {
        if (!titles.length) throw new Error('Aucun titre TMDB');
        return resolveSlug(resolvedTmdbId, titles); 
      })
      .then(function(slug) {
        if (!slug) throw new Error('Slug introuvable');
        return fetchEpisodePage(slug, s, e);
      })
      .then(function(page) {
        var sources = parseChapterSources(page.html);
        if (!sources.length) throw new Error('Aucune source dans thisChapterSources');
        var lang = detectLangFromUrl(page.url);
        console.log('[VoirDrama] Langue:', lang.toUpperCase(), '| Sources:', sources.length);
        return buildStreams(sources, lang, s, e);
      });
  }

  return pipeline()
    .catch(function(err) {
      console.error('[VoirDrama] Erreur pipeline:', err && err.message || err);
      return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
