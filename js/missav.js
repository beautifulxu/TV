const HOST = 'https://missav.ws';
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

function parseList(html) {
  const list = [];
  if (!html) return list;

  // Match video card items - missav typically uses article or div with video info
  // Pattern 1: <a href="/xxx" class="..." title="..."><img src="..." alt="..."></a>
  const itemRegex = /<a\b([^>]*href="([^"]+)"[^>]*)>[\s\S]*?<img\b([^>]*)>[\s\S]*?<\/a>/gi;
  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    const href = match[2];
    const imgAttrs = match[3];
    
    // Skip non-video links
    if (href === '/' || href === '#' || href.startsWith('javascript:')) continue;
    if (href.includes('/dm265') || href.includes('/category') || href.includes('/search')) continue;
    
    // Extract image
    const srcMatch = imgAttrs.match(/src="([^"]+)"/);
    const dataSrcMatch = imgAttrs.match(/data-src="([^"]+)"/);
    const vodPic = dataSrcMatch ? dataSrcMatch[1] : (srcMatch ? srcMatch[1] : '');
    
    // Extract title from alt or title attribute
    const altMatch = imgAttrs.match(/alt="([^"]*)"/);
    const titleAttrMatch = match[1].match(/title="([^"]*)"/);
    const vodName = titleAttrMatch ? titleAttrMatch[1] : (altMatch ? altMatch[1] : '');
    
    const vodId = abs(href);
    if (!vodId || !vodName) continue;
    
    list.push({
      vod_id: vodId,
      vod_name: vodName,
      vod_pic: abs(vodPic),
    });
  }

  // Pattern 2: Modern card layout with div containers
  if (list.length === 0) {
    const cardRegex = /<div[^>]*class="[^"]*thumbnail[^"]*"[^>]*>[\s\S]*?<a\b([^>]*href="([^"]+)"[^>]*)>[\s\S]*?<img\b([^>]*)>[\s\S]*?<\/a>[\s\S]*?<div[^>]*class="[^"]*info[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi;
    let cardMatch;
    while ((cardMatch = cardRegex.exec(html)) !== null) {
      const href = cardMatch[2];
      const imgAttrs = cardMatch[3];
      const nameText = text(cardMatch[4]);
      
      const srcMatch = imgAttrs.match(/src="([^"]+)"/);
      const dataSrcMatch = imgAttrs.match(/data-src="([^"]+)"/);
      const vodPic = dataSrcMatch ? dataSrcMatch[1] : (srcMatch ? srcMatch[1] : '');
      
      const vodId = abs(href);
      if (!vodId || !nameText) continue;
      
      list.push({
        vod_id: vodId,
        vod_name: nameText,
        vod_pic: abs(vodPic),
      });
    }
  }

  return list;
}

function parsePageCount(html) {
  // Look for pagination links
  const pageMatches = html.match(/href="[^"]*page[=/](\d+)[^"]*"/gi) || [];
  let maxPage = 1;
  for (const m of pageMatches) {
    const num = parseInt(m.match(/page[=/](\d+)/i)[1]);
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
    const pagecount = parsePageCount(html);
    return JSON.stringify({
      page,
      pagecount,
      limit: list.length || 24,
      total: list.length * pagecount,
      list: list,
    });
  },

  detail(id) {
    const pageUrl = abs(id);
    const html = request(pageUrl);
    if (!html) {
      return JSON.stringify({ list: [] });
    }

    // Extract title
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const name = titleMatch ? text(titleMatch[1]).replace(/ - missav.*$/i, '') : '';

    // Extract description
    const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i);
    const desc = descMatch ? descMatch[1] : '';

    // Extract image from og:image
    const imgMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
    const pic = imgMatch ? imgMatch[1] : '';

    // Extract video URL - look for various video source patterns
    const videoUrls = [];
    
    // Pattern 1: video src or data-src
    const videoSrcRegex = /<(?:video|source)\b[^>]*src="([^"]+\.(?:mp4|m3u8)[^"]*)"/gi;
    let vMatch;
    while ((vMatch = videoSrcRegex.exec(html)) !== null) {
      videoUrls.push(vMatch[1]);
    }

    // Pattern 2: JavaScript variable containing video URL
    const jsUrlRegex = /(?:src|url|file)\s*[:=]\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/gi;
    let jMatch;
    while ((jMatch = jsUrlRegex.exec(html)) !== null) {
      videoUrls.push(jMatch[1]);
    }

    // Pattern 3: data-source or data-url attributes
    const dataAttrRegex = /data-(?:source|url|src)="([^"]+\.(?:mp4|m3u8)[^"]*)"/gi;
    let dMatch;
    while ((dMatch = dataAttrRegex.exec(html)) !== null) {
      videoUrls.push(dMatch[1]);
    }

    // Build play URL
    let vodPlayUrl = '';
    if (videoUrls.length > 0) {
      vodPlayUrl = videoUrls
        .map((url, index) => `播放${index + 1}$${abs(url)}`)
        .join('#');
    }

    return JSON.stringify({
      list: [{
        vod_id: pageUrl,
        vod_name: name,
        vod_pic: pic,
        vod_content: desc,
        vod_play_from: 'missav',
        vod_play_url: vodPlayUrl,
      }],
    });
  },

  search(key) {
    const url = `${HOST}/search?q=${encodeURIComponent(key)}`;
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
