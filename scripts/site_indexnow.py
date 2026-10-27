"""Notify IndexNow about public content after a verified site deployment.

The verification key is intentionally public. State is private Git metadata,
shared by this clone's worktrees; preserve it when moving the publishing clone.
"""

import hashlib
import json
import re
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from dev_evidence import timestamp, write_json

HOST = "pulshealth.com"
ORIGIN = "https://" + HOST
ENDPOINT = "https://api.indexnow.org/indexnow"
KEY_FILE = "indexnow-key.txt"
MAX_URLS = 10000


def page_path(url):
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.netloc != HOST or parsed.query or parsed.fragment
            or not re.fullmatch(r"/(?:[A-Za-z0-9_-]+/)*", parsed.path)):
        raise ValueError("IndexNow requires a canonical public site URL")
    return parsed.path.lstrip("/") + "index.html"


class Content(HTMLParser):
    """Ignore build chunks, CSS, animation SVGs and repeated site chrome."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.main = False
        self.title = False
        self.skip = None
        self.structured = False
        self.structured_text = []
        self.tokens = []

    def handle_starttag(self, tag, attrs):
        if self.skip:
            return
        attrs = dict(attrs)
        if tag in ("script", "style", "svg"):
            self.skip = tag
            self.structured = tag == "script" and attrs.get("type") == "application/ld+json"
            self.structured_text = []
            return
        if tag == "main":
            self.main = True
        if tag == "title":
            self.title = True
        if tag == "meta" and (attrs.get("name", "").lower() in ("description", "robots", "googlebot")
                              or attrs.get("property", "").startswith("og:")):
            self.tokens.append([tag, sorted(attrs.items())])
        if tag == "link" and attrs.get("rel") == "canonical":
            self.tokens.append([tag, attrs.get("href")])
        if self.main:
            relevant = {k: v for k, v in attrs.items() if k in ("href", "src", "alt", "aria-label")}
            if relevant or tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
                self.tokens.append([tag, sorted(relevant.items())])

    def handle_endtag(self, tag):
        if self.skip:
            if tag == self.skip:
                if self.structured:
                    self.tokens.append(["jsonld", json.loads("".join(self.structured_text))])
                self.skip = None
                self.structured = False
            return
        if tag == "main":
            self.main = False
        if tag == "title":
            self.title = False

    def handle_data(self, value):
        if self.structured:
            self.structured_text.append(value)
        elif not self.skip and (self.main or self.title):
            value = " ".join(value.split())
            if value:
                self.tokens.append(value)


def content_hash(html):
    content = Content()
    content.feed(html)
    return hashlib.sha256(json.dumps(content.tokens, sort_keys=True).encode()).hexdigest()


def public_pages(out):
    sitemap = ET.fromstring((out / "sitemap.xml").read_text())
    pages = {}
    for entry in sitemap.findall("{*}url"):
        url = entry.findtext("{*}loc")
        name = page_path(url or "")
        file = out / name
        if not file.resolve().is_relative_to(out.resolve()):
            raise ValueError("IndexNow page escapes export")
        if url in pages:
            raise ValueError("Duplicate sitemap URL")
        pages[url] = content_hash(file.read_text())
    if not pages:
        raise ValueError("Refusing an empty public sitemap")
    return pages


def changed_urls(before, after):
    return sorted(url for url in before.keys() | after.keys() if before.get(url) != after.get(url))


def read_state(path):
    if not path.exists():
        return None
    state = json.loads(path.read_text())
    if state.get("schema") != 1 or state.get("host") != HOST or not isinstance(state.get("pages"), dict):
        raise ValueError("Invalid IndexNow state; restore the publishing clone's state")
    for url, digest in state["pages"].items():
        page_path(url)
        if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("Invalid IndexNow content fingerprint")
    return state


def notify(out, state_path, *, bootstrap=False):
    """Return a separate notification outcome; never call this before live verification.

    No baseline defaults to initialization without retroactive submissions.
    bootstrap=True is explicit enrollment of a newly launched/recently changed site.
    Each accepted batch is checkpointed; the next verified publish retries failures.
    """
    result = {"status": "pending", "endpoint": ENDPOINT, "batches": [], "urls": []}
    try:
        pages = public_pages(out)
        previous = read_state(state_path)
        if previous is None and not bootstrap:
            write_json(state_path, {"schema": 1, "host": HOST, "pages": pages, "updated_at": timestamp()})
            result["status"] = "baseline-initialized"
            return result
        urls = changed_urls(previous["pages"] if previous else {}, pages)
        result["urls"] = urls
        if not urls:
            result["status"] = "unchanged"
            return result
        if previous is None:
            # Persist enrollment before sending: failed bootstrap requests must
            # retry on a later normal deploy instead of becoming a silent baseline.
            write_json(state_path, {"schema": 1, "host": HOST, "pages": {}, "updated_at": timestamp()})
        key = (out / KEY_FILE).read_text().strip()
        if not re.fullmatch(r"[A-Za-z0-9-]{8,128}", key):
            raise ValueError("Invalid public IndexNow verification key")
        acknowledged = dict(previous["pages"]) if previous else {}
        for offset in range(0, len(urls), MAX_URLS):
            batch = urls[offset:offset + MAX_URLS]
            payload = {"host": HOST, "key": key, "keyLocation": ORIGIN + "/" + KEY_FILE, "urlList": batch}
            request = Request(ENDPOINT, data=json.dumps(payload).encode(), method="POST",
                              headers={"Content-Type": "application/json; charset=utf-8",
                                       "User-Agent": "PulsHealth-IndexNow/1.0"})
            with urlopen(request, timeout=20) as response:
                status = response.status
            result["batches"].append({"count": len(batch), "http_status": status})
            if status not in (200, 202):
                raise ValueError("Unexpected IndexNow HTTP response")
            for url in batch:
                if url in pages:
                    acknowledged[url] = pages[url]
                else:
                    acknowledged.pop(url, None)
            write_json(state_path, {"schema": 1, "host": HOST, "pages": acknowledged, "updated_at": timestamp()})
        result["status"] = "accepted-pending-verification" if any(b["http_status"] == 202 for b in result["batches"]) else "accepted"
    except Exception as error:
        # This optional external service must not relabel a verified site as failed.
        # No body/credentials/private paths are copied into the receipt.
        result["status"] = "failed"
        result["error"] = type(error).__name__
        if isinstance(error, HTTPError):
            result["http_status"] = error.code
    return result
