#!/usr/bin/env python3
"""Shared Life Partner cookie loading and CSRF validation helpers."""

import json
import uuid
from pathlib import Path
from urllib import error, request


BASE_URL = "https://www.life-partner.cn"
CSRF_TOKEN_PATH = "/life/partner/v1/common/csrf/token"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
)


class LifePartnerSession:
    def __init__(self, cookie, timeout, base_url=BASE_URL, referer=""):
        self.cookie = cookie
        self.timeout = timeout
        self.base_url = base_url.rstrip("/")
        self.referer = referer or self.base_url
        self.session_id = str(uuid.uuid4())
        self.csrf_token = ""
        self.csrf_session_id = ""

    def common_headers(self):
        return {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Cookie": self.cookie,
            "Pragma": "no-cache",
            "Referer": self.referer,
            "User-Agent": USER_AGENT,
            "x-tt-ls-session-id": self.session_id,
        }

    def ensure_csrf_token(self):
        if self.csrf_token:
            return self.csrf_token

        headers = self.common_headers()
        headers.update(
            {
                "Origin": self.base_url,
                "x-secsdk-csrf-request": "1",
                "x-secsdk-csrf-version": "1.2.22",
            }
        )
        response_headers, _ = self.open_url(
            "HEAD",
            self.url(CSRF_TOKEN_PATH),
            headers=headers,
            data=None,
        )
        raw_token = response_headers.get("x-ware-csrf-token", "")
        token_info = raw_token.split(",")
        if len(token_info) < 2 or token_info[0] != "0" or not token_info[1]:
            raise RuntimeError(
                "CSRF token 获取失败: "
                f"header_parts={token_info[:4]} status_header_present={bool(raw_token)}"
            )
        self.csrf_token = token_info[1]
        if len(token_info) > 4:
            self.csrf_session_id = token_info[4]
        return self.csrf_token

    def get_json(self, path, query=None, csrf=False):
        url = self.url_with_query(path, query)
        headers = self.common_headers()
        if csrf:
            headers["x-secsdk-csrf-token"] = self.ensure_csrf_token()
        _, body = self.open_url("GET", url, headers=headers, data=None)
        return parse_json_or_text(body)

    def post_json(self, path, payload, query=None):
        token = self.ensure_csrf_token()
        csrf_values = [token]
        if self.csrf_session_id:
            csrf_values.append(f"{token},{self.csrf_session_id}")

        url = self.url_with_query(path, query)

        last_error = None
        for csrf_value in csrf_values:
            headers = self.common_headers()
            headers.update(
                {
                    "Content-Type": "application/json",
                    "Origin": self.base_url,
                    "x-secsdk-csrf-token": csrf_value,
                }
            )
            try:
                _, body = self.open_url(
                    "POST",
                    url,
                    headers=headers,
                    data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                )
                return parse_json_or_text(body)
            except RuntimeError as exc:
                last_error = exc
                if "HTTP 403" not in str(exc) or csrf_value == csrf_values[-1]:
                    raise
        raise last_error or RuntimeError("POST failed")

    def download_file(self, download_url, dest):
        url = absolutize_url(download_url, self.base_url)
        headers = self.common_headers()
        headers["Accept"] = "*/*"
        req = request.Request(url, headers=headers, method="GET")
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            with request.urlopen(req, timeout=self.timeout) as resp:
                with dest.open("wb") as file_obj:
                    while True:
                        chunk = resp.read(1024 * 128)
                        if not chunk:
                            break
                        file_obj.write(chunk)
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {exc.code} while downloading: {body[:500]}") from exc
        return dest

    def open_url(self, method, url, headers, data):
        req = request.Request(url, data=data, headers=headers, method=method)
        try:
            with request.urlopen(req, timeout=self.timeout) as resp:
                return resp.headers, resp.read()
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {exc.code}: {body[:500]}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"Request failed: {exc}") from exc

    def url(self, path):
        if path.startswith("http://") or path.startswith("https://"):
            return path
        return self.base_url + path

    def url_with_query(self, path, query=None):
        url = self.url(path)
        if not query:
            return url
        from urllib import parse

        parsed = parse.urlsplit(url)
        params = dict(parse.parse_qsl(parsed.query, keep_blank_values=True))
        params.update({key: str(value) for key, value in query.items() if value is not None})
        return parse.urlunsplit(
            (
                parsed.scheme,
                parsed.netloc,
                parsed.path,
                parse.urlencode(params),
                parsed.fragment,
            )
        )


def validate_cookie_or_exit(session, provider_name="", output_label="cookie"):
    try:
        session.ensure_csrf_token()
    except RuntimeError as exc:
        raise SystemExit(
            json.dumps(
                {
                    "cookie_valid": False,
                    "provider": provider_name,
                    "output_label": output_label,
                    "check": "secsdk_csrf_token",
                    "error": concise_error(exc),
                },
                ensure_ascii=False,
                indent=2,
            )
        ) from exc


def resolve_cookie(args):
    provider_name = ""
    cookie_source = getattr(args, "cookie_file", "")
    providers_file = getattr(args, "providers_file", "")
    provider_arg = getattr(args, "provider", "")
    raw_cookie = getattr(args, "cookie", "")
    if providers_file:
        provider = load_provider(Path(providers_file).expanduser(), provider_arg)
        provider_name = str(provider.get("name") or provider_arg or "")
        if not cookie_source:
            cookie_source = provider_cookie_file(provider)
            if cookie_source:
                cookie_source = str((Path(providers_file).expanduser().resolve().parent / cookie_source).resolve())

    if raw_cookie:
        cookie = normalize_cookie(raw_cookie)
    elif cookie_source:
        cookie = load_cookie_file(Path(cookie_source).expanduser(), provider_name or None)
    else:
        raise SystemExit("Missing cookie input: use --cookie, --cookie-file, or --providers-file with --provider")

    if not cookie:
        raise SystemExit("Cookie input was empty or could not be parsed")
    return provider_name, cookie


def load_provider(providers_file, provider_name):
    if not providers_file.exists():
        raise SystemExit(f"providers file not found: {providers_file}")
    data = json.loads(providers_file.read_text(encoding="utf-8"))
    providers = []
    if isinstance(data, list):
        for index, item in enumerate(data):
            if isinstance(item, dict):
                copied = dict(item)
                copied.setdefault("name", f"provider_{index}")
                providers.append(copied)
    elif isinstance(data, dict):
        for key, value in data.items():
            if isinstance(value, dict):
                copied = dict(value)
                copied.setdefault("name", key)
                providers.append(copied)

    if provider_name:
        for provider in providers:
            if provider.get("name") == provider_name:
                return provider
        raise SystemExit(f"provider not found in {providers_file}: {provider_name}")
    if len(providers) == 1:
        return providers[0]
    raise SystemExit("--provider is required when providers.json contains multiple providers")


def provider_cookie_file(provider):
    for key in ("cookieFile", "cookie_file", "cookiesFile", "cookies_file"):
        value = provider.get(key)
        if value:
            return str(value)
    raise SystemExit(f"provider has no cookieFile: {provider.get('name', '')}")


def load_cookie_file(path, provider_name=None):
    if not path.exists():
        raise SystemExit(f"cookie file not found: {path}")
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return ""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return normalize_cookie(text)
    return cookie_data_to_header(data, provider_name)


def cookie_data_to_header(data, provider_name=None):
    if isinstance(data, list):
        pairs = {}
        for item in data:
            if isinstance(item, dict) and item.get("name") and item.get("value") is not None:
                pairs[str(item["name"])] = str(item["value"])
        return cookie_pairs_to_header(pairs)
    if isinstance(data, dict):
        if provider_name and provider_name in data and isinstance(data[provider_name], dict):
            entry = data[provider_name]
            if isinstance(entry.get("cookies"), dict):
                return cookie_pairs_to_header(entry["cookies"])
            return cookie_pairs_to_header(entry)
        if "cookies" in data and isinstance(data["cookies"], dict):
            return cookie_pairs_to_header(data["cookies"])
        return cookie_pairs_to_header(data)
    if isinstance(data, str):
        return normalize_cookie(data)
    return ""


def normalize_cookie(raw_cookie):
    pairs = {}
    for item in raw_cookie.replace("\n", ";").split(";"):
        item = item.strip()
        if not item or "=" not in item:
            continue
        name, value = item.split("=", 1)
        name = name.strip()
        value = value.strip()
        if name:
            pairs[name] = value
    return cookie_pairs_to_header(pairs)


def cookie_pairs_to_header(pairs):
    normalized = {}
    for name, value in pairs.items():
        if name and value is not None and not isinstance(value, (dict, list)):
            normalized[str(name).strip()] = str(value).strip()
    return "; ".join(f"{name}={value}" for name, value in normalized.items() if name)


def parse_json_or_text(body):
    text = body.decode("utf-8", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def absolutize_url(url, base_url):
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return base_url.rstrip("/") + url
    return url


def concise_error(exc):
    return " ".join(str(exc).split())[:300]
