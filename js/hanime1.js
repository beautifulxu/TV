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

  // Match video cards: <div class="playlist-video-card video-item-container">...</div>
  const cardRegex = /<div class="playlist-video-card video-item-container">(.*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/g;
  let match;
  while ((match = cardRegex.exec(html)) !== null) {
    const card = match[1];

    // Extract href from <a> tag
    const hrefMatch = card.match(/<a\s+href="([^"]+)"/);
    // Extract img src
    const imgMatch = card.match(/<img[^>]*src="([^"]+)"/);
    // Extract title from <h4 class="video-title"><a>标题</a>
    const titleMatch = card.match(/<h4 class="video-title">\s*<a[^>]*>\s*([^<]+)\s*<\/a>/);

    const vodId = hrefMatch ? hrefMatch[1] : '';
    const vodPic = imgMatch ? imgMatch[1] : '';
    const vodName = titleMatch ? titleMatch[1].trim() : '';

    if (vodId && vodName) {
      list.push({
        vod_id: vodId,
        vod_name: vodName,
        vod_pic: vodPic,
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

    // Extract video source: <source src="...">
    const sourceMatch = html.match(/<source[^>]*src="([^"]+)"/);
    const videoUrl = sourceMatch ? sourceMatch[1] : '';

    // Extract title from og:title
    const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/);
    const name = ogTitleMatch ? ogTitleMatch[1].replace(/ - Hanime1\.me$/, '') : '';

    // Extract description
    const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/);
    const desc = descMatch ? descMatch[1] : '';

    // Extract image from og:image
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
