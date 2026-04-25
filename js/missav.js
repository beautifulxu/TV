const HOST = 'https://missav.ws';
const CDN = 'https://fourhoi.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': `${HOST}/`,
};

const CLASSES = [
  ['dm265', '动漫'],
];

function request(url) {
  try {
    const res = globalThis._http(url, { headers: HEADERS, timeout: 15000 });
    if (res && res.content) {
      // Check for Cloudflare block
      if (res.content.indexOf('Just a moment') !== -1 || res.content.indexOf('Attention Required') !== -1 || res.content.indexOf('Cloudflare') !== -1) {
        return '';
      }
      return res.content;
    }
  } catch(e) {}
  return '';
}

function text(value) {
  return (value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/"/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function abs(url) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${HOST}${url}`;
  return url;
}

/**
 * Decode the eval'd JavaScript from the detail page to extract video URLs.
 * The format is:
 *   eval(function(p,a,c,k,e,d){...}('encoded_string',N,N,'key1|key2|...'.split('|'),0,{}))
 * 
 * The encoded string uses placeholders: 0-9 for first 10 keys, then a,b,c... for subsequent keys.
 * Uses two-pass replacement to avoid conflicts between placeholders and key values.
 */
function decodeEval(html) {
  if (!html) return null;
  
  // Find eval(function by index
  const idx = html.indexOf('eval(function');
  if (idx < 0) return null;
  
  // Count parentheses to find the full eval expression
  let depth = 0;
  let end = idx;
  for (let i = idx; i < html.length; i++) {
    if (html[i] === '(') depth++;
    else if (html[i] === ')') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  
  const evalStr = html.substring(idx, end);
  
  // Find the arguments after the function body: }('...') or }("...")
  const argsStart = evalStr.indexOf('}(');
  if (argsStart < 0) return null;
  
  const args = evalStr.substring(argsStart + 2, evalStr.length - 2);
  
  // Find .split from the end to locate the keys string
  const splitPos = args.lastIndexOf('.split');
  if (splitPos < 0) return null;
  
  // Go backwards from splitPos to find the keys string (between quotes)
  let keysStart = -1;
  let keysEnd = -1;
  for (let i = splitPos - 1; i >= 0; i--) {
    if (args[i] === "'" || args[i] === '"') {
      keysEnd = i;  // closing quote of the keys string
      // Find the opening quote
      for (let j = i - 1; j >= 0; j--) {
        if (args[j] === args[i]) {
          keysStart = j + 1;
          break;
        }
      }
      break;
    }
  }
  if (keysStart < 0 || keysEnd < 0) return null;
  
  const keysStr = args.substring(keysStart, keysEnd);
  const keys = keysStr.split('|');
  
  // Find the first quoted string (encoded data)
  let encodedStart = -1;
  let encodedEnd = -1;
  let encodedQuoteChar = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "'" || args[i] === '"') {
      encodedStart = i + 1;
      encodedQuoteChar = args[i];
      // Find the matching closing quote
      for (let j = i + 1; j < args.length; j++) {
        if (args[j] === encodedQuoteChar) {
          encodedEnd = j;
          break;
        }
      }
      break;
    }
  }
  if (encodedStart < 0 || encodedEnd < 0) return null;
  
  const encoded = args.substring(encodedStart, encodedEnd);
  
  // Two-pass replacement to avoid conflicts
  // Pass 1: Replace placeholders with unique temp markers
  let temp = encoded;
  const tempMarkers = [];
  for (let i = 0; i < keys.length; i++) {
    let placeholder;
    if (i < 10) {
      placeholder = String(i);
    } else {
      placeholder = String.fromCharCode(97 + i - 10);
    }
    const tempMarker = '\x00TEMP' + i + '\x00';
    tempMarkers.push({ tempMarker, value: keys[i] });
    temp = temp.split(placeholder).join(tempMarker);
  }
  
  // Pass 2: Replace temp markers with actual values
  let result = temp;
  for (const { tempMarker, value } of tempMarkers) {
    result = result.split(tempMarker).join(value);
  }
  
  return result;
}

/**
 * Extract video UUID from the decoded eval content.
 * The decoded content contains URLs like:
 *   https://surrit.com/{uuid}/playlist.m3u8
 *   https://surrit.com/{uuid}/video/720p.m3u8
 */
function extractVideoUrl(decoded) {
  if (!decoded) return '';
  
  // Try to find surrit.com playlist URL
  const playlistMatch = decoded.match(/https:\/\/surrit\.com\/([a-f0-9-]+)\/playlist\.m3u8/);
  if (playlistMatch) {
    return playlistMatch[0];
  }
  
  // Try to find any surrit.com video URL
  const surritMatch = decoded.match(/https:\/\/surrit\.com\/[a-f0-9-]+\/video\/\d+p\.m3u8/);
  if (surritMatch) {
    return surritMatch[0];
  }
  
  // Try to find any m3u8 URL
  const m3u8Match = decoded.match(/https:[^"'<>]+\.m3u8/);
  if (m3u8Match) {
    return m3u8Match[0];
  }
  
  return '';
}

/**
 * Parse video items from the missav page HTML.
 * The page has video items in preload divs and recommendation sections.
 * Each item has:
 *   <a href="https://missav.ws/{path}" alt="{dvd_id}">
 *   <img data-src="https://fourhoi.com/{dvd_id}/cover-t.jpg" alt="{title}">
 */
function parseList(html) {
  const list = [];
  if (!html) return list;

  // Pattern: Find video items by looking for <a> tags with href to missav.ws
  // that contain an <img> with data-src from fourhoi.com
  // Note: The alt attribute can appear before or after href in the <a> tag
  const itemRegex = /<a\s+(?:href="https:\/\/missav\.ws(\/[^"]+)"[^>]*alt="([^"]*)"|alt="([^"]*)"[^>]*href="https:\/\/missav\.ws(\/[^"]+)")[^>]*>[\s\S]*?<img[^>]*data-src="https:\/\/fourhoi\.com\/([^"]+)\/cover-t\.jpg"[^>]*alt="([^"]*)"[\s\S]*?<\/a>/gi;
  let match;
  const seen = new Set();
  
  while ((match = itemRegex.exec(html)) !== null) {
    // Handle both orderings of href and alt
    const href = match[1] || match[4];
    const altId = match[2] || match[3];
    const dvdId = match[5];
    const title = match[6];
    
    // Skip duplicates - use href as the primary key since it's the actual video page URL
    if (!href || !title) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    
    const vodId = `${HOST}${href}`;
    const vodPic = `${CDN}/${dvdId}/cover-t.jpg`;
    
    list.push({
      vod_id: vodId,
      vod_name: text(title),
      vod_pic: vodPic,
    });
  }

  // Fallback: Try to find items from the preload divs
  if (list.length === 0) {
    const preloadRegex = /<div\s+id="preload_\d+"[^>]*>[\s\S]*?<a\s+(?:href="https:\/\/missav\.ws(\/[^"]+)"[^>]*alt="([^"]*)"|alt="([^"]*)"[^>]*href="https:\/\/missav\.ws(\/[^"]+)")[^>]*>[\s\S]*?<img[^>]*data-src="https:\/\/fourhoi\.com\/([^"]+)\/cover-t\.jpg"[^>]*alt="([^"]*)"[\s\S]*?<\/a>/gi;
    let pMatch;
    while ((pMatch = preloadRegex.exec(html)) !== null) {
      const href = pMatch[1] || pMatch[4];
      const altId = pMatch[2] || pMatch[3];
      const dvdId = pMatch[5];
      const title = pMatch[6];
      
      if (!href || !title) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      
      list.push({
        vod_id: `${HOST}${href}`,
        vod_name: text(title),
        vod_pic: `${CDN}/${dvdId}/cover-t.jpg`,
      });
    }
  }

  return list;
}

const spider = {
  init() {},

  home() {
    return JSON.stringify({
      class: CLASSES.map(([type_id, type_name]) => ({ type_id, type_name })),
    });
  },

  homeVod() {
    return this.category('dm265', '1');
  },

  category(tid, pg) {
    const page = Number(pg || 1);
    let url;
    if (tid === 'dm265') {
      url = page <= 1 ? `${HOST}/dm265` : `${HOST}/dm265/page/${page}`;
    } else {
      url = page <= 1 ? `${HOST}/category/${tid}` : `${HOST}/category/${tid}/page/${page}`;
    }
    const html = request(url);
    const list = parseList(html);
    return JSON.stringify({
      page,
      pagecount: 1,
      limit: list.length || 24,
      total: list.length,
      list: list,
    });
  },

  detail(id) {
    const pageUrl = abs(id);
    
    // Extract the dvd_id from the URL
    // URL format: https://missav.ws/{dvd_id} or https://missav.ws/dm{num}/{dvd_id}
    const dvdIdMatch = pageUrl.match(/([^/]+)\/?$/);
    const dvdId = dvdIdMatch ? dvdIdMatch[1] : '';
    
    // Try to get the detail page (may fail due to Cloudflare)
    const html = request(pageUrl);
    
    let name = dvdId;
    let pic = '';
    let desc = '';
    let videoUrl = '';
    
    if (html) {
      // Extract title
      const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
      if (titleMatch) {
        name = text(titleMatch[1]).replace(/ - missav.*$/i, '');
      }
      
      // Extract description
      const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i);
      if (descMatch) desc = descMatch[1];
      
      // Extract image from og:image
      const imgMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
      if (imgMatch) pic = imgMatch[1];
      
      // Try to decode the eval'd JavaScript to get the real video URL
      const decoded = decodeEval(html);
      if (decoded) {
        videoUrl = extractVideoUrl(decoded);
      }
    }
    
    // If we couldn't get the real video URL, fall back to preview.mp4
    if (!videoUrl) {
      videoUrl = `${CDN}/${dvdId}/preview.mp4`;
    }
    
    const vodPlayUrl = `播放$${videoUrl}`;

    return JSON.stringify({
      list: [{
        vod_id: pageUrl,
        vod_name: name,
        vod_pic: pic || `${CDN}/${dvdId}/cover-t.jpg`,
        vod_content: desc,
        vod_play_from: 'missav',
        vod_play_url: vodPlayUrl,
      }],
    });
  },

  search(key) {
    // Fix: Use /search/{keyword} format instead of /search?q=
    const url = `${HOST}/search/${encodeURIComponent(key)}`;
    const html = request(url);
    return JSON.stringify({
      list: parseList(html),
    });
  },

  play(flag, id) {
    return JSON.stringify({
      parse: 0,
      url: id,
      header: HEADERS,
    });
  },

  live() { return ''; },
  sniffer() { return false; },
  isVideo(url) { return /\.(mp4|m3u8)(\?|$)/i.test(url); },
  proxy() { return [404, 'text/plain', '']; },
  action() { return ''; },
  destroy() {},
};

export default spider;
