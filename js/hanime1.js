const HOST = 'https://hanime1.me';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': `${HOST}/`,
};

const CLASSES = [
  ['playlist', '播放列表'],
];

function request(url) {
  try {
    const res = globalThis._http(url, { headers: HEADERS, timeout: 15000 });
    if (res && res.content) {
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

function parseList(html) {
  const list = [];
  if (!html) return list;

  // Try to find all links that look like video/watch pages
  const linkRegex = /<a[^>]*href="([^"]*\/watch\?v=[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const inner = match[2];

    // Extract image from inside the link
    const imgMatch = inner.match(/<img[^>]*src="([^"]+)"[^>]*>/);
    const vodPic = imgMatch ? imgMatch[1] : '';

    // Extract title from inside the link
    const titleMatch = inner.match(/title="([^"]*)"/);
    const altMatch = inner.match(/alt="([^"]*)"/);
    const textMatch = inner.match(/>([^<]+)</);
    const vodName = titleMatch ? titleMatch[1] : (altMatch ? altMatch[1] : (textMatch ? textMatch[1].trim() : ''));

    if (href && vodName) {
      list.push({
        vod_id: abs(href),
        vod_name: vodName,
        vod_pic: vodPic,
      });
    }
  }

  // If no watch links found, try to find any links with thumbnails
  if (list.length === 0) {
    const blocks = html.match(/<a[^>]*href="([^"]+)"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>[\s\S]*?<\/a>/g) || [];
    for (const block of blocks) {
      const hrefMatch = block.match(/href="([^"]+)"/);
      const imgMatch = block.match(/src="([^"]+)"/);
      const titleMatch = block.match(/title="([^"]*)"/);
      const altMatch = block.match(/alt="([^"]*)"/);
      const vodId = hrefMatch ? abs(hrefMatch[1]) : '';
      const vodPic = imgMatch ? imgMatch[1] : '';
      const vodName = titleMatch ? titleMatch[1] : (altMatch ? altMatch[1] : '');
      if (vodId && vodName && !vodId.includes('cdn-cgi')) {
        list.push({ vod_id: vodId, vod_name: vodName, vod_pic: vodPic });
      }
    }
  }

  // Last resort: try to parse JSON data from script tags
  if (list.length === 0) {
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/g;
    while ((match = scriptRegex.exec(html)) !== null) {
      const scriptContent = match[1];
      // Try to find JSON data with video/playlist info
      const jsonMatch = scriptContent.match(/\[[\s\S]*?"(?:title|name)"[\s\S]*?\]/);
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[0]);
          for (const item of data) {
            if (item.title || item.name) {
              list.push({
                vod_id: abs(item.url || item.link || item.id || ''),
                vod_name: item.title || item.name || '',
                vod_pic: item.thumbnail || item.pic || item.image || item.thumb || '',
              });
            }
          }
        } catch(e) {}
      }
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
    const list = parseList(html);
    return JSON.stringify({
      page,
      pagecount: 1,
      limit: list.length || 24,
      total: list.length || 24,
      list: list,
    });
  },

  detail(id) {
    const html = request(abs(id));
    if (!html) {
      return JSON.stringify({ list: [] });
    }

    let videoUrl = '';
    const patterns = [
      /"url"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]+)"/,
      /"video_url"\s*:\s*"([^"]+)"/,
      /data-src=['"]([^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/,
      /<source[^>]*src=['"]([^'"]+)['"]/,
      /<video[^>]*src=['"]([^'"]+)['"]/,
      /src=['"]([^'"]+\.(?:mp4|m3u8)[^'"]*)['"]/,
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
