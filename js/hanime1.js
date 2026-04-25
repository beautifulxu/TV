const HOST = 'https://hanime1.me';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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

function abs(url) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${HOST}${url}`;
  return url;
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

    // Build play URL with all available resolutions
    let playUrl = '';
    if (videoUrl) {
      playUrl = `1$${videoUrl}`;
    }
    return JSON.stringify({
      list: [{
        vod_id: abs(id),
        vod_name: name,
        vod_pic: pic,
        vod_content: desc,
        vod_play_from: 'hanime1',
        vod_play_url: playUrl,
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
