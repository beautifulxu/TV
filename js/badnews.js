const HOST = 'https://bad.news';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: `${HOST}/`,
};

const CLASSES = [
  ['dm', '动漫'],
  ['q-3D', '3D动画'],
  ['q-同人', '同人作品'],
  ['q-Cosplay', 'Cosplay'],
];

function request(url) {
  const res = globalThis._http(url, { headers: HEADERS, timeout: 15000 });
  return res && res.content ? res.content : '';
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
  // Match article blocks
  const blocks = html.match(/<article[\s\S]*?<\/article>/g) || [];
  for (const block of blocks) {
    const hrefMatch = block.match(/href="([^"]+)"/);
    const imgMatch = block.match(/data-echo="([^"]+)"/);
    const titleMatch = block.match(/<a class="title"[^>]*title="([^"]*)"/);
    const nameMatch = block.match(/alt="([^"]*)"/);

    const vodId = hrefMatch ? abs(hrefMatch[1]) : '';
    const vodPic = imgMatch ? imgMatch[1] : '';
    const vodName = titleMatch ? titleMatch[1] : (nameMatch ? nameMatch[1] : '');
    if (!vodId || !vodName) continue;
    list.push({
      vod_id: vodId,
      vod_name: vodName,
      vod_pic: vodPic,
    });
  }
  return list;
}

function parsePageCount(html) {
  // Find the last page number from pagination
  const matches = html.match(/href="\/dm\/page-(\d+)"/g) || [];
  let maxPage = 1;
  for (const m of matches) {
    const num = parseInt(m.match(/page-(\d+)/)[1]);
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
    return this.category('dm', '1');
  },

  category(tid, pg) {
    const page = Number(pg || 1);
    let url;
    if (tid === 'dm') {
      url = page <= 1 ? `${HOST}/dm` : `${HOST}/dm/page-${page}`;
    } else {
      url = page <= 1 ? `${HOST}/dm/type/${tid}` : `${HOST}/dm/type/${tid}/page-${page}`;
    }
    const html = request(url);
    const pagecount = parsePageCount(html);
    return JSON.stringify({
      page,
      pagecount,
      limit: 24,
      total: pagecount * 24,
      list: parseList(html),
    });
  },

  detail(id) {
    const html = request(abs(id));
    // Extract video source URL
    const sourceMatch = html.match(/data-source='([^']+)'/);
    const videoUrl = sourceMatch ? sourceMatch[1] : '';
    // Extract title
    const titleMatch = html.match(/<h1 class="title">([\s\S]*?)<\/h1>/);
    const name = titleMatch ? text(titleMatch[1]) : '';
    // Extract description
    const descMatch = html.match(/简介：([\s\S]*?)<\/p>/);
    const desc = descMatch ? text(descMatch[1]) : '';
    // Extract image from og:image
    const imgMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
    const pic = imgMatch ? imgMatch[1] : '';
    // Extract tags
    const tags = [];
    const tagMatches = html.match(/<a href="\/dm\/tag\/[^"]*"[^>]*>([^<]+)<\/a>/g) || [];
    for (const t of tagMatches) {
      const tagName = t.match(/>([^<]+)<\/a>/);
      if (tagName) tags.push(tagName[1]);
    }

    return JSON.stringify({
      list: [{
        vod_id: abs(id),
        vod_name: name,
        vod_pic: pic,
        vod_content: desc + (tags.length ? '\n标签：' + tags.join('、') : ''),
        vod_play_from: 'bad.news',
        vod_play_url: videoUrl ? `播放$${videoUrl}` : '',
      }],
    });
  },

  search(key) {
    const url = `${HOST}/dm/search/q-${encodeURIComponent(key)}`;
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

  live() {
    return '';
  },

  sniffer() {
    return false;
  },

  isVideo(url) {
    return /\.(mp4|m3u8)(\?|$)/i.test(url);
  },

  proxy() {
    return [404, 'text/plain', ''];
  },

  action() {
    return '';
  },

  destroy() {},
};

export default spider;
