import logging
import os
import re
from typing import Optional
from urllib.parse import parse_qs, urlparse

import requests
from dotenv import load_dotenv

from app.services.cookie_manager import CookieConfigManager
from app.utils.logger import get_logger
KUAISHOU_API_BASE = 'https://www.kuaishou.com/graphql'
KUAISHOU_URL = "https://www.kuaishou.com/"
load_dotenv()
headers = {
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    # 'Cookie': 'did=web_9e8cfa4403000587b9e7d67233e6b04c; didv=1719811812378; kpf=PC_WEB; clientid=3; kpn=KUAISHOU_VISION',
    'Origin': 'https://www.kuaishou.com',
    'Pragma': 'no-cache',
    'Referer': 'https://www.kuaishou.com/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'accept': '*/*',
    'content-type': 'application/json',
    'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    # 'Cookie':cookies.strip()
}

logger = get_logger(__name__)

cfm=CookieConfigManager()


def kuaishou_duration_to_seconds(duration_ms: object) -> int:
    """将快手详情接口返回的毫秒时长转换为秒。"""
    try:
        milliseconds = float(duration_ms)
        if milliseconds <= 0:
            return 0
        return int(round(milliseconds / 1000))
    except (TypeError, ValueError, OverflowError):
        return 0


class KuaiShou:
    def __init__(self):
        self.header = headers.copy()
        self.cookie = None
        # 暴露 active cookie id 给上层 (note.py) 用于精确失败上报.
        # 与 Downloader 基类保持一致, 但 ``KuaiShou`` 不是 ``Downloader`` 子类,
        # 因此这里直接维护一份.
        self._active_cookie_id: Optional[int] = None
        self._active_cookie_source: Optional[str] = None
        self._active_platform: str = "kuaishou"

    @staticmethod
    def _extract_kuaishou_link(text):

        url = re.findall(r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\(\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+', text)
        return url[0] if url else None

    @staticmethod
    def _extract_photo_id_from_url(url: str) -> Optional[str]:
        """从快手详情 URL 或分享页 URL 中提取作品 photoId。"""
        parsed = urlparse(url)
        query = parse_qs(parsed.query)
        for key in ("photoId", "photo_id"):
            if query.get(key) and query[key][0]:
                return query[key][0]

        path = parsed.path.rstrip("/")
        patterns = (
            r"/short-video/([^/?#]+)",
            r"/@[^/]+/video/([^/?#]+)",
            r"/(?:fw/)?photo/([^/?#]+)",
        )
        for pattern in patterns:
            match = re.search(pattern, path)
            if match:
                return match.group(1)
        return None

    def get_photo_id(self, url):
        direct_photo_id = self._extract_photo_id_from_url(url)
        if direct_photo_id:
            return direct_photo_id

        response = requests.get(url, allow_redirects=True, headers=self.header)
        real_url = response.url
        photo_id = self._extract_photo_id_from_url(real_url)
        if photo_id:
            return photo_id

        # 某些风控/分享页不会把 photoId 放在最终地址，而会写在 HTML 中。
        page = getattr(response, "text", "") or ""
        html_patterns = (
            r"[?&]photoId=([^&#\"']+)",
            r"[\"']photoId[\"']\s*[:=]\s*[\"']([^\"']+)",
            r"/short-video/([^/?#\"']+)",
        )
        for pattern in html_patterns:
            match = re.search(pattern, page)
            if match:
                return match.group(1)

        raise ValueError(f"无法从快手链接解析视频 ID: {url} (redirected to {real_url})")

    def set_cookie_meta(self, meta) -> None:
        """KuaiShou 不是 Downloader 子类, 显式写一遍"""
        self._active_cookie_id = getattr(meta, "cookie_id", None)
        self._active_cookie_source = getattr(meta, "source", None)
        if getattr(meta, "cookie", None):
            self.header['Cookie'] = meta.cookie.strip()

    def get_temp_cookies(self):
        meta = cfm.get_with_meta('kuaishou')
        # 同步 active cookie id 给上层
        self._active_cookie_id = meta.cookie_id
        self._active_cookie_source = meta.source
        is_exist = meta.cookie
        print(is_exist)
        if is_exist:
            return is_exist
        res = requests.get(url=KUAISHOU_URL, headers=self.header, allow_redirects=True)
        cookie_string = '; '.join([f"{k}={v}" for k, v in res.cookies.get_dict().items()])
        return cookie_string

    def get_video_details(self, url, photo_id):
        json_data = {
            'operationName': 'visionVideoDetail',
            "variables": {"photoId": photo_id, "page": "detail"},
            "query": "query visionVideoDetail($photoId: String, $type: String, $page: String, $webPageArea: String) {\n  visionVideoDetail(photoId: $photoId, type: $type, page: $page, webPageArea: $webPageArea) {\n    status\n    type\n    author {\n      id\n      name\n      following\n      headerUrl\n      __typename\n    }\n    photo {\n      id\n      duration\n      caption\n      likeCount\n      realLikeCount\n      coverUrl\n      photoUrl\n      liked\n      timestamp\n      expTag\n      llsid\n      viewCount\n      videoRatio\n      stereoType\n      croppedPhotoUrl\n      manifest {\n        mediaType\n        businessType\n        version\n        adaptationSet {\n          id\n          duration\n          representation {\n            id\n            defaultSelect\n            backupUrl\n            codecs\n            url\n            height\n            width\n            avgBitrate\n            maxBitrate\n            m3u8Slice\n            qualityType\n            qualityLabel\n            frameRate\n            featureP2sp\n            hidden\n            disableAdaptive\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    tags {\n      type\n      name\n      __typename\n    }\n    commentLimit {\n      canAddComment\n      __typename\n    }\n    llsid\n    danmakuSwitch\n    __typename\n  }\n}\n"
        }
        response = requests.post(url=KUAISHOU_API_BASE, headers=self.header, json=json_data)
        if response.status_code == 200:
            response.raise_for_status()

            return response.json()
        else:
            return None

    def run(self, url):
        real_url = self._extract_kuaishou_link(url)
        if not real_url:
            raise ValueError(f"无法从输入中识别快手视频链接: {url}")

        cookies = self.get_temp_cookies()
        if not cookies:
            logger.error(f"快手视频 cookies 解析失败 {url},请考虑设置环境变量 KUAISHOU_COOKIES")

        self.header['Cookie'] = cookies.strip()
        photo_id = self.get_photo_id(real_url)
        video_details = self.get_video_details(real_url, photo_id)
        if not video_details or not video_details.get('data'):
            raise ValueError(f"快手视频详情解析失败，可能是链接失效或触发风控: {url}")
        return video_details['data']


if __name__ == '__main__':
    ks = KuaiShou()
    ks.run(
        'https://v.kuaishou.com/2vBqX74 王宝强携手刘昊然、岳云鹏上演精彩名场面 全程高能 看一遍笑一遍 "唐探1900 "快成长计划 ...更多')
