const HOST = 'https://hanime1.me';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Origin': HOST,
  'Referer': `${HOST}/`,
};

const CLASSES = [
  ['裏番', '裏番'],
  ['泡麵番', '泡麵番'],
  ['Motion Anime', 'Motion Anime'],
  ['3DCG', '3DCG'],
  ['2.5D', '2.5D'],
  ['2D動畫', '2D動畫'],
  ['AI生成', 'AI生成'],
  ['MMD', 'MMD'],
  ['Cosplay', 'Cosplay'],
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
      if (res.content.indexOf('Attention Required') !== -1 || res.content.indexOf('Cloudflare') !== -1) {
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
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
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

function query(url, key) {
  const match = String(url || '').match(new RegExp(`[?&]${key}=([^&#]+)`));
  return match ? decodeURIComponent(match[1]) : '';
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

function parseDownloadList(html) {
  const list = [];
  if (!html) return list;

  const tableMatch = html.match(/<table[^>]*class="[^"]*download-table[^"]*"[\s\S]*?<\/table>/i);
  const source = tableMatch ? tableMatch[0] : html;
  const linkRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(source)) !== null) {
    const attrs = match[1];
    const hrefMatch = attrs.match(/\bhref=(["'])(.*?)\1/i);
    if (!hrefMatch) continue;

    const url = abs(decode(hrefMatch[2]));
    if (!/\.(mp4|m3u8)(?:[?#]|$)/i.test(url)) continue;

    const downloadMatch = attrs.match(/\bdownload=(["'])(.*?)\1/i);
    const rawName = downloadMatch ? downloadMatch[2] : match[2];
    const quality = qualityFromUrl(url);
    const name = text(rawName) || quality || `播放${list.length + 1}`;
    list.push({ name, url });
  }
  return unique(list);
}

function parseInlineVideos(html) {
  const list = [];
  if (!html) return list;

  const sourceRegex = /<(?:source|video)\b[^>]*(?:src|data-src)=(["'])(.*?)\1/gi;
  let sourceMatch;
  while ((sourceMatch = sourceRegex.exec(html)) !== null) {
    const url = abs(decode(sourceMatch[2]));
    if (/\.(mp4|m3u8)(?:[?#]|$)/i.test(url)) {
      list.push({ name: qualityFromUrl(url) || `播放${list.length + 1}`, url });
    }
  }

  const attrRegex = /(?:file|src|url)\s*[:=]\s*(["'])(https?:\\?\/\\?\/.*?\.(?:mp4|m3u8).*?)\1/gi;
  let attrMatch;
  while ((attrMatch = attrRegex.exec(html)) !== null) {
    const url = decode(attrMatch[2]);
    list.push({ name: qualityFromUrl(url) || `播放${list.length + 1}`, url });
  }

  const urlRegex = /https?:\\?\/\\?\/(?:\\\/|[^"'<>\\\s])+?\.(?:mp4|m3u8)(?:\?(?:\\\/|[^"'<>\\\s])*)?/gi;
  let urlMatch;
  while ((urlMatch = urlRegex.exec(html)) !== null) {
    const url = decode(urlMatch[0]);
    list.push({ name: qualityFromUrl(url) || `播放${list.length + 1}`, url });
  }

  return unique(list);
}

function buildPlayUrl(items) {
  return unique(items)
    .map((item, index) => {
      const name = text(item.name).replace(/[$#]/g, ' ').replace(/\s+/g, ' ').trim() || `播放${index + 1}`;
      return `${name}$${item.url}`;
    })
    .join('#');
}

function parseList(html) {
  const list = [];
  if (!html) return list;

  // Match horizontal-card structure (used in home page and most search pages)
  // <div class="horizontal-card">
  //   <a href="/watch?v=XXX" class="video-link">
  //     <div class="thumb-container">
  //       <img src="...">
  //       ...
  //     </div>
  //     <div class="title">标题</div>
  //   </a>
  //   <div class="subtitle">...</div>
  // </div>
  // </div>
  const cardRegex = /<div class="horizontal-card">(.*?)<\/div>\s*<\/div>\s*<div class="title">/g;
  let match;
  while ((match = cardRegex.exec(html)) !== null) {
    const card = match[1];
    const hrefMatch = card.match(/<a[^>]*href="([^"]+watch\?v=\d+[^"]*)"[^>]*class="video-link"/);
    if (!hrefMatch) continue;
    const imgMatch = card.match(/<img[^>]*src="([^"]+)"/);
    const titleStart = match.index + match[0].length;
    const titleEnd = html.indexOf('</div>', titleStart);
    const vodName = titleStart < titleEnd ? html.substring(titleStart, titleEnd).trim() : '';
    const vodId = hrefMatch[1];
    const vodPic = imgMatch ? imgMatch[1] : '';
    if (vodId && vodName) {
      list.push({ vod_id: vodId, vod_name: vodName, vod_pic: vodPic });
    }
  }

  // Match alternative structure (used in some search pages like 裏番)
  // <a style="text-decoration: none;" href="/watch?v=XXX">
  //   <div class="home-rows-videos-div search-videos hover-lighter">
  //     <div class="video-card-inner">
  //       <img src="cover.jpg">
  //       <div class="home-rows-videos-title">标题</div>
  //     </div>
  //   </div>
  // </a>
  const altRegex = /<a[^>]*href="([^"]+watch\?v=\d+[^"]*)"[^>]*>\s*<div class="home-rows-videos-div search-videos hover-lighter">(.*?)<\/a>/g;
  let altMatch;
  while ((altMatch = altRegex.exec(html)) !== null) {
    const vodId = altMatch[1];
    const content = altMatch[2];
    const imgMatch = content.match(/<img[^>]*src="([^"]+)"/);
    const titleMatch = content.match(/<div class="home-rows-videos-title">\s*([^<]+)\s*<\/div>/);
    const vodPic = imgMatch ? imgMatch[1] : '';
    const vodName = titleMatch ? titleMatch[1].trim() : '';
    if (vodId && vodName) {
      // Avoid duplicates
      if (!list.some(v => v.vod_id === vodId)) {
        list.push({ vod_id: vodId, vod_name: vodName, vod_pic: vodPic });
      }
    }
  }

  return list;
}

function parsePageCount(html) {
  // Find the last page number from pagination
  const matches = html.match(/page=(\d+)"/g) || [];
  let maxPage = 1;
  for (const m of matches) {
    const num = parseInt(m.match(/page=(\d+)/)[1]);
    if (num > maxPage) maxPage = num;
  }
  return maxPage;
}

const spider = {
  init() {},

  home() {
    return JSON.stringify({
      class: CLASSES.map(([type_id, type_name]) => ({ type_id, type_name })),
    });
  },

  homeVod() {
    // Return latest videos from home page
    const html = request(HOST);
    const list = parseList(html);
    return JSON.stringify({
      list: list.slice(0, 24),
    });
  },

  category(tid, pg) {
    const page = Number(pg || 1);
    const sort = '&sort=最新上傳';
    let url;
    if (tid === '全部' || !tid) {
      url = page <= 1 ? `${HOST}/search` : `${HOST}/search?page=${page}`;
    } else {
      const encodedGenre = encodeURIComponent(tid);
      url = page <= 1
        ? `${HOST}/search?genre=${encodedGenre}${sort}`
        : `${HOST}/search?genre=${encodedGenre}${sort}&page=${page}`;
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

    const vid = query(pageUrl, 'v');
    const downloadHtml = vid ? request(`${HOST}/download?v=${encodeURIComponent(vid)}`, pageUrl) : '';
    const playItems = parseDownloadList(downloadHtml).concat(parseInlineVideos(html));

    // Extract title from og:title
    const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/);
    const name = ogTitleMatch ? decode(ogTitleMatch[1]).replace(/ - Hanime1\.me$/, '') : '';

    // Extract description
    const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/);
    const desc = descMatch ? decode(descMatch[1]) : '';

    // Extract image from og:image
    const imgMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/);
    const pic = imgMatch ? imgMatch[1] : '';

    return JSON.stringify({
      list: [{
        vod_id: pageUrl,
        vod_name: name,
        vod_pic: pic,
        vod_content: desc,
        vod_play_from: 'hanime1',
        vod_play_url: buildPlayUrl(playItems),
      }],
    });
  },

  search(key) {
    const url = `${HOST}/search?query=${encodeURIComponent(key)}`;
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
