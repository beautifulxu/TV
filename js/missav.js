const HOST = 'https://missav.ws';
const CDN = 'https://fourhoi.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
  'Origin': HOST,
  'Referer': `${HOST}/`,
};

const CLASSES = [
  ['全部', '全部'],
  ['FC2', 'FC2'],
  ['中文字幕', '中文字幕'],
  ['無碼影片', '無碼影片'],
  ['HD', 'HD'],
];

function headers(referer) {
  const items = {};
  for (const key in HEADERS) items[key] = HEADERS[key];
  if (referer) items.Referer = referer;
  return items;
}

function request(url, referer) {
  try {
    const res = globalThis._http(url, { headers: headers(referer), timeout: 15000 });
    if (res && res.content) {
      if (res.content.indexOf('Attention Required') !== -1 || res.content.indexOf('Cloudflare') !== -1 || res.content.indexOf('Just a moment') !== -1) {
        return '';
      }
      return res.content;
    }
  } catch(e) {}
  return '';
}

function decode(value) {
  return (value || '')
    .replace(/\\\//g, '/')
    .replace(/&/g, '&')
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/</g, '<')
    .replace(/>/g, '>');
}

function text(value) {
  return decode(value)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function abs(url) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${HOST}${url}`;
  return url;
}

function unique(items) {
  const seen = {};
  const list = [];
  for (const item of items) {
    if (!item || !item.url || seen[item.url]) continue;
    seen[item.url] = true;
    list.push(item);
  }
  return list;
}

function qualityFromUrl(url) {
  const match = String(url || '').match(/(?:^|[-_/])(\d{3,4}p)(?:[-_.?/#]|$)/i);
  return match ? match[1] : '';
}

function attr(source, name) {
  const match = String(source || '').match(new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, 'i'));
  return match ? decode(match[2]) : '';
}

/**
 * Decode the packed eval JS used by missav to hide video URLs.
 * Format: eval(function(p,a,c,k,e,d){...}('...',16,16,'word1|word2|...'.split('|'),0,{}))
 */
function decodeEval(html) {
  if (!html) return '';
  
  // Find the eval statement
  const evalIdx = html.indexOf('eval(function(p,a,c,k,e,d)');
  if (evalIdx === -1) return '';
  
  // Extract the full eval by counting parentheses
  let depth = 0;
  let end = evalIdx;
  for (let i = evalIdx; i < html.length; i++) {
    if (html[i] === '(') depth++;
    else if (html[i] === ')') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  
  const evalStr = html.substring(evalIdx, end);
  
  // Find the arguments: after 'return p}('
  const argsStart = evalStr.indexOf('return p}(') + 'return p}('.length;
  const args = evalStr.substring(argsStart, evalStr.length - 2); // remove trailing '))'
  
  // Parse the comma-separated arguments
  // arg1: encoded string (starts and ends with ', may contain escaped quotes \')
  // arg2: radix (number)
  // arg3: count (number)
  // arg4: word list string (starts and ends with ')
  // arg5: 0
  // arg6: {}
  
  let i = 0;
  
  // Skip whitespace
  while (i < args.length && args[i] === ' ') i++;
  
  // Parse arg1: the encoded string
  if (args[i] !== "'") return '';
  i++; // skip opening quote
  let encoded = '';
  while (i < args.length) {
    if (args[i] === '\\' && i + 1 < args.length && args[i+1] === "'") {
      encoded += "'";
      i += 2;
    } else if (args[i] === "'") {
      i++; // skip closing quote
      break;
    } else {
      encoded += args[i];
      i++;
    }
  }
  
  // Skip whitespace and comma
  while (i < args.length && (args[i] === ' ' || args[i] === ',')) i++;
  
  // Parse arg2: radix
  let radixStr = '';
  while (i < args.length && /\d/.test(args[i])) {
    radixStr += args[i];
    i++;
  }
  const radix = parseInt(radixStr);
  
  // Skip whitespace and comma
  while (i < args.length && (args[i] === ' ' || args[i] === ',')) i++;
  
  // Parse arg3: count
  let countStr = '';
  while (i < args.length && /\d/.test(args[i])) {
    countStr += args[i];
    i++;
  }
  const count = parseInt(countStr);
  
  // Skip whitespace and comma
  while (i < args.length && (args[i] === ' ' || args[i] === ',')) i++;
  
  // Parse arg4: word list string
  if (args[i] !== "'") return '';
  i++; // skip opening quote
  let wordsStr = '';
  while (i < args.length) {
    if (args[i] === "'") {
      i++; // skip closing quote
      break;
    } else {
      wordsStr += args[i];
      i++;
    }
  }
  const words = wordsStr.split('|');
  
  // Build the dictionary
  const dict = {};
  for (let j = 0; j < count && j < words.length; j++) {
    const key = j.toString(radix);
    dict[key] = words[j];
  }
  
  // Replace all word boundaries
  let result = encoded;
  for (const key in dict) {
    const regex = new RegExp('\\b' + key + '\\b', 'g');
    result = result.replace(regex, dict[key]);
  }
  
  return result;
}

/**
 * Extract video URLs from the decoded eval JS.
 * The decoded JS contains variable assignments like:
 *   source='https://surrit.com/.../playlist.m3u8';
 *   source842='https://surrit.com/.../720p/video.m3u8';
 *   source1280='https://surrit.com/.../1080p/video.m3u8';
 */
function extractVideoUrls(decoded) {
  const urls = [];
  if (!decoded) return urls;
  
  // Match all URL assignments
  const urlRegex = /['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/g;
  let match;
  while ((match = urlRegex.exec(decoded)) !== null) {
    const url = match[1];
    if (!urls.some(u => u.url === url)) {
      const quality = qualityFromUrl(url);
      urls.push({
        name: quality || `播放${urls.length + 1}`,
        url: url,
      });
    }
  }
  
  return urls;
}

function parseList(html) {
  const list = [];
  if (!html) return list;

  // The page has SSR-rendered cards with actual data.
  // Two patterns:
  // 1. With wrapper: <div class="">\n    <div @mouseenter="setPreview(...)" ... class="thumbnail group">
  // 2. Without wrapper: <div @mouseenter="setPreview(...)" ... class="thumbnail group">
  //
  // Inner structure:
  // <div @mouseenter="setPreview('UUID')" ... class="thumbnail group">
  //   <div class="relative aspect-w-16 aspect-h-9 rounded overflow-hidden shadow-lg">
  //     <a href="https://missav.ws/DVD_ID" alt="DVD_ID">
  //       <video ... data-src="https://fourhoi.com/DVD_ID/preview.mp4"></video>
  //       <img ... data-src="https://fourhoi.com/DVD_ID/cover-t.jpg" alt="TITLE">
  //     </a>
  //     ...
  //   </div>
  //   <div class="my-2 text-sm text-nord4 truncate">
  //     <a class="text-secondary group-hover:text-primary" href="https://missav.ws/DVD_ID" alt="DVD_ID">TITLE</a>
  //   </div>
  // </div>

  // Match all SSR-rendered cards - find the thumbnail group divs that contain actual hrefs
  const cardRegex = /<div @mouseenter="setPreview\('[^']+'\)"[^>]*class="thumbnail group">\s*<div class="relative aspect-w-16 aspect-h-9 rounded overflow-hidden shadow-lg">\s*<a href="https:\/\/missav\.ws\/([^"]+)" alt="[^"]*">[\s\S]*?<\/a>[\s\S]*?<\/div>\s*<div class="my-2 text-sm text-nord4 truncate">\s*<a class="[^"]*" href="https:\/\/missav\.ws\/[^"]+" alt="[^"]*">([\s\S]*?)<\/a>\s*<\/div>\s*<\/div>/g;
  let match;
  while ((match = cardRegex.exec(html)) !== null) {
    const dvdId = match[1];
    const title = text(match[2]);
    
    // Extract the cover image from the card content
    const cardContent = match[0];
    const imgMatch = cardContent.match(/<img[^>]*data-src="([^"]+)"[^>]*>/);
    const pic = imgMatch ? imgMatch[1] : '';
    
    if (dvdId && title) {
      const vodId = `${HOST}/${dvdId}`;
      if (!list.some(v => v.vod_id === vodId)) {
        list.push({
          vod_id: vodId,
          vod_name: title,
          vod_pic: pic,
        });
      }
    }
  }

  return list;
}

function parsePageCount(html) {
  // The page doesn't have traditional pagination for the home page
  // For category/search pages, look for page links
  const matches = html.match(/[?&]page=(\d+)/g) || [];
  let maxPage = 1;
  for (const m of matches) {
    const num = parseInt(m.match(/(\d+)/)[1]);
    if (num > maxPage) maxPage = num;
  }
  return maxPage || 1;
}

const spider = {
  init() {},

  home() {
    return JSON.stringify({
      class: CLASSES.map(([type_id, type_name]) => ({ type_id, type_name })),
    });
  },

  homeVod() {
    return this.category('全部', '1');
  },

  category(tid, pg) {
    const page = Number(pg || 1);
    let url = `${HOST}/dm265`;
    if (tid && tid !== '全部') {
      url = `${HOST}/dm265?filter=${encodeURIComponent(tid)}`;
    }
    if (page > 1) {
      url += `${url.includes('?') ? '&' : '?'}page=${page}`;
    }
    
    const html = request(url);
    const list = parseList(html);
    const pagecount = parsePageCount(html);
    
    return JSON.stringify({
      page,
      pagecount: pagecount || 1,
      limit: list.length || 24,
      total: list.length * (pagecount || 1),
      list: list,
    });
  },

  detail(id) {
    const pageUrl = abs(id);
    const html = request(pageUrl);
    if (!html) {
      return JSON.stringify({ list: [] });
    }

    // Extract title from og:title
    const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/);
    const name = ogTitleMatch ? decode(ogTitleMatch[1]) : '';

    // Extract image from og:image
    const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/);
    const pic = ogImageMatch ? ogImageMatch[1] : '';

    // Extract description
    const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/);
    const desc = descMatch ? decode(descMatch[1]) : '';

    // Decode the eval'd JS to get video URLs
    const decoded = decodeEval(html);
    const playItems = extractVideoUrls(decoded);

    // Build play URL string
    const playUrls = playItems
      .map((item, index) => {
        const name = item.name || `播放${index + 1}`;
        return `${name}$${item.url}`;
      })
      .join('#');

    return JSON.stringify({
      list: [{
        vod_id: pageUrl,
        vod_name: name,
        vod_pic: pic,
        vod_content: desc,
        vod_play_from: 'missav',
        vod_play_url: playUrls || `${name}$${pageUrl}`,
      }],
    });
  },

  search(key) {
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
