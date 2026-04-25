#!/usr/bin/env python3
"""
missav.ws Cloudflare 绕过代理服务
用法: python3 missav_proxy.py [端口号]
默认端口: 9876

在 TVBox 的 missav.js 中设置 PROXY = 'http://你的IP:9876/'
"""

import cloudscraper
import re
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, quote, unquote
import sys

HOST = 'https://missav.ws'
CDN = 'https://fourhoi.com'

scraper = cloudscraper.create_scraper(browser={
    'browser': 'chrome',
    'platform': 'windows',
    'desktop': True,
})

def fetch(url):
    """通过 cloudscraper 获取页面内容"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': f'{HOST}/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
    }
    try:
        resp = scraper.get(url, headers=headers, timeout=30)
        return resp.status_code, resp.text
    except Exception as e:
        return 500, str(e)


def parse_list(html):
    """解析列表页，提取视频卡片"""
    items = []
    if not html:
        return items
    
    # 找所有视频卡片 - 从 Alpine.js 的 x-data 中提取
    # 页面使用 Alpine.js 客户端渲染，但 cloudscraper 拿到的 HTML 包含 Alpine 模板
    # 我们需要从 Alpine 的 x-data 或 x-init 中提取数据
    
    # 方法1: 找 SSR 卡片 (如果有的话)
    card_pattern = r'<a\s+href="https://missav\.ws/([^"]+)"[^>]*>.*?<img[^>]*data-src="([^"]*)"[^>]*>.*?<a[^>]*href="https://missav\.ws/[^"]+"[^>]*>([^<]+)</a>'
    for m in re.finditer(card_pattern, html, re.DOTALL):
        dvd_id = m.group(1)
        pic = m.group(2)
        title = re.sub(r'<[^>]+>', '', m.group(3)).strip()
        if dvd_id and title:
            items.append({
                'vod_id': f'{HOST}/{dvd_id}',
                'vod_name': title,
                'vod_pic': pic,
            })
    
    # 方法2: 从 Alpine.js 的 x-data 中提取 (如果方法1没找到)
    if not items:
        # 找 x-data 中的 items 数组
        data_matches = re.findall(r'items:\s*(\[[^\]]+\])', html)
        for data_str in data_matches:
            try:
                # 尝试解析 JSON 格式的 items
                data_str = data_str.replace("'", '"')
                data_str = re.sub(r'(\w+):', r'"\1":', data_str)
                items_data = json.loads(data_str)
                for item in items_data:
                    if isinstance(item, dict) and 'dvd_id' in item:
                        items.append({
                            'vod_id': f'{HOST}/{item["dvd_id"]}',
                            'vod_name': item.get('title', ''),
                            'vod_pic': f'{CDN}/{item["dvd_id"]}/cover-t.jpg',
                        })
            except:
                pass
    
    return items


def parse_detail(html):
    """解析详情页"""
    result = {'name': '', 'pic': '', 'desc': '', 'urls': []}
    
    # og:title
    m = re.search(r'<meta[^>]*property="og:title"[^>]*content="([^"]+)"', html)
    if m: result['name'] = m.group(1)
    
    # og:image
    m = re.search(r'<meta[^>]*property="og:image"[^>]*content="([^"]+)"', html)
    if m: result['pic'] = m.group(1)
    
    # description
    m = re.search(r'<meta[^>]*name="description"[^>]*content="([^"]*)"', html)
    if m: result['desc'] = m.group(1)
    
    # eval decode
    idx = html.find('eval(function(p,a,c,k,e,d)')
    if idx >= 0:
        depth = 0
        end = idx
        for i in range(idx, len(html)):
            if html[i] == '(': depth += 1
            elif html[i] == ')':
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        eval_str = html[idx:end]
        
        # 解析 eval 参数
        args_start = eval_str.find("return p}(") + len("return p}(")
        args = eval_str[args_start:-2]  # remove trailing ))
        
        # 解析参数
        i = 0
        while i < len(args) and args[i] == ' ': i += 1
        
        # arg1: encoded string
        if args[i] != "'": return result
        i += 1
        encoded = ''
        while i < len(args):
            if args[i] == '\\' and i+1 < len(args) and args[i+1] == "'":
                encoded += "'"
                i += 2
            elif args[i] == "'":
                i += 1
                break
            else:
                encoded += args[i]
                i += 1
        
        # skip to arg4 (words)
        while i < len(args) and args[i] != "'": i += 1
        if i >= len(args): return result
        i += 1
        words_str = ''
        while i < len(args):
            if args[i] == "'":
                break
            else:
                words_str += args[i]
                i += 1
        words = words_str.split('|')
        
        # 解码
        decoded = encoded
        for j, w in enumerate(words):
            key = format(j, 'x') if j < 16 else format(j, 'g')
            decoded = decoded.replace(key, w)
        
        # 提取 URL
        for m in re.finditer(r"['\"](https?://[^'\"]+\.m3u8[^'\"]*)['\"]", decoded):
            url = m.group(1)
            quality = ''
            qm = re.search(r'(?:^|[-_/])(\d{3,4}p)', url)
            if qm: quality = qm.group(1)
            result['urls'].append({
                'name': quality or f'播放{len(result["urls"])+1}',
                'url': url,
            })
    
    return result


class ProxyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        
        if parsed.path == '/list':
            # /list?url=https://missav.ws/dm265
            url = params.get('url', [HOST + '/dm265'])[0]
            code, html = fetch(url)
            if code == 200:
                items = parse_list(html)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'code': 200, 'list': items}).encode('utf-8'))
            else:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'code': code, 'list': [], 'error': html[:200]}).encode('utf-8'))
        
        elif parsed.path == '/detail':
            url = params.get('url', [''])[0]
            if not url:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'Missing url')
                return
            
            code, html = fetch(url)
            if code == 200:
                detail = parse_detail(html)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'code': 200, 'detail': detail}).encode('utf-8'))
            else:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'code': code, 'detail': {}, 'error': html[:200]}).encode('utf-8'))
        
        elif parsed.path == '/search':
            keyword = params.get('keyword', [''])[0]
            if keyword:
                url = f'{HOST}/search/{quote(keyword)}'
                code, html = fetch(url)
                if code == 200:
                    items = parse_list(html)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({'code': 200, 'list': items}).encode('utf-8'))
                else:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({'code': code, 'list': []}).encode('utf-8'))
            else:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'Missing keyword')
        
        elif parsed.path == '/raw':
            # 直接获取原始 HTML
            url = params.get('url', [''])[0]
            if url:
                code, html = fetch(url)
                self.send_response(code)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(html.encode('utf-8'))
            else:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'Missing url')
        
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'Not found')
    
    def log_message(self, format, *args):
        print(f"[{self.address_string()}] {format % args}")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9876
    server = HTTPServer(('0.0.0.0', port), ProxyHandler)
    print(f"missav proxy server running on http://0.0.0.0:{port}")
    print(f"Endpoints:")
    print(f"  GET /list?url=...  - 获取视频列表")
    print(f"  GET /detail?url=... - 获取视频详情")
    print(f"  GET /search?keyword=... - 搜索")
    print(f"  GET /raw?url=... - 获取原始 HTML")
    server.serve_forever()


if __name__ == '__main__':
    main()
