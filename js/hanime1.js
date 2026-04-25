const HOST = 'https://hanime1.me';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': `${HOST}/`,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

const CLASSES = [
  ['playlist', '播放列表'],
];

function request(url) {
  try {
    const res = globalThis._http(url, { headers: HEADERS, timeout: 15000 });
    if (res && res.content) {
      // Check if we got blocked by Cloudflare
      if (res.content.indexOf('Attention Required') !== -1 || res.content.indexOf('Cloudflare') !== -1) {
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

function parseVideoList(html) {
  const list = [];
  if (!html) return list;

  // Try to match video items from playlist page
  // Pattern 1: <a href="/watch?v=XXXX"> with thumbnail
  const itemRegex = /<a[^>]*href="(\/watch\?v=[^"]+)"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>[\s\S]*?<div[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    const vodId = abs(match[1]);
    const vodPic = match[2];
    const vodName = text(match[3]);
    if (vodId && vodName) {
      list.push({ vod_id: vodId, vod_name: vodName, vod_pic: vodPic });
    }
  }

  // Pattern 2: Simpler structure
  if (list.length === 0) {
    const blocks = html.match(/<a[^>]*href="[^"]*watch\?v=[^"]*"[^>]*>[\s\S]*?<\/a>/g) || [];
    for (const block of blocks) {
      const hrefMatch = block.match(/href="([^"]+)"/);
      const imgMatch = block.match(/<img[^>]*src="([^"]+)"/);
      const titleMatch = block.match(/title="([^"]*)"/);
      const altMatch = block.match(/alt="([^"]*)"/);
      const vodId = hrefMatch ? abs(hrefMatch[1]) : '';
      const vodPic = imgMatch ? imgMatch[1] : '';
      const vodName = titleMatch ? titleMatch[1] : (altMatch ? altMatch[1] : '');
      if (vodId && vodName) {
        list.push({ vod_id: vodId, vod_name: vodName, vod_pic: vodPic });
      }
    }
  }

  // Pattern 3: JSON data embedded in page
  if (list.length === 0) {
    const jsonMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        const videos = data.videos || data.playlist || data.list || [];
        for (const v of videos) {
          list.push({
            vod_id: abs(v.url || v.link || `/watch?v=${v.id}`),
            vod_name: v.title || v.name || '',
            vod_pic: v.thumbnail || v.pic || v.image || '',
          });
        }
      } catch(e) {}
    }
  }

  return list;
}

function parsePageCount(html) {
  if (!html) return 1;
  const pageLinks = html.match(/[?&]page=(\d+)/g) || [];
  let maxPage = 1;
  for (const m of pageLinks) {
    const num = parseInt(m.split('=')[1]);
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
    return this.category('playlist', '1');
  },

  category(tid, pg) {
    const page = Number(pg || 1);
    let url;
    if (tid === 'playlist') {
      url = `${HOST}/playlist?list=1744`;
    } else {
      url = `${HOST}/playlist?list=${tid}&page=${page}`;
    }
    const html = request(url);
    const pagecount = parsePageCount(html);
    return JSON.stringify({
      page,
      pagecount,
      limit: 24,
      total: pagecount * 24,
      list: parseVideoList(html),
    });
  },

  detail(id) {
    const html = request(abs(id));
    if (!html) {
      return JSON.stringify({ list: [] });
    }

    let videoUrl = '';
    const patterns = [
      /data-src=['"]([^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/,
      /src=['"]([^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/,
      /source[^>]*src=['"]([^'"]+)['"]/,
      /video[^>]*src=['"]([^'"]+)['"]/,
      /"url"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]+)"/,
      /"video_url"\s*:\s*"([^"]+)"/,
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        videoUrl = match[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/');
        break;
      }
    }

    const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    const name = titleMatch ? text(titleMatch[1]) : '';

    const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/);
    const desc = descMatch ? descMatch[1] : '';

    const imgMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/);
    const pic = imgMatch ? imgMatch[1] : '';

    return JSON.stringify({
      list: [{
        vod_id: abs(id),
        vod_name: name,
        vod_pic: pic,
        vod_content: desc,
        vod_play_from: 'hanime1',
        vod_play_url: videoUrl ? `播放$${videoUrl}` : '',
      }],
    });
  },

  search(key) {
    const url = `${HOST}/search?q=${encodeURIComponent(key)}`;
    const html = request(url);
    return JSON.stringify({
      list: parseVideoList(html),
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
