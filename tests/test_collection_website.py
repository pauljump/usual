"""The public collection stays read-only and its six tools share one catalog."""
from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from html.parser import HTMLParser

import pytest

from usual.server import PublicAutopilotHandler, ThreadingHTTPServer
from usual import website


@pytest.fixture(scope="module")
def public_url():
    server = ThreadingHTTPServer(("127.0.0.1", 0), PublicAutopilotHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    server.server_close()


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta":
            self.values[attrs.get("property", attrs.get("name"))] = attrs.get("content")
        if tag == "link" and attrs.get("rel") == "canonical":
            self.values["canonical"] = attrs["href"]


def test_catalog_pages_and_agent_guides_are_the_same_product(public_url):
    with urllib.request.urlopen(public_url + "/catalog.json") as response:
        data = json.load(response)
    assert data == website.catalog()
    with urllib.request.urlopen(public_url) as response:
        home = response.read().decode()
    assert "<!-- CATALOG_MENU -->" not in home
    assert "SYNTHETIC EXAMPLE" in home
    assert "Nothing on this page reads your files" in home
    for item in data["items"]:
        assert f'/menu/{item["id"]}/' in home
        with urllib.request.urlopen(public_url + f'/menu/{item["id"]}/') as response:
            page = response.read().decode()
            assert response.headers.get_content_type() == "text/html"
        assert item["name"] in page
        assert website.esc(item["benefit"]) in page
        assert website.esc(item["source"]["url"]) in page
        assert website.esc(website.readable(item["verification"])) in page
        tags = Metadata()
        tags.feed(page)
        assert tags.values["canonical"] == f'https://tryusual.com/menu/{item["id"]}/'
        assert tags.values["twitter:card"] == "summary_large_image"
        assert tags.values["og:image"] == tags.values["twitter:image"]
        for action in ("install", "use"):
            # Pop's short install URL remains the existing standalone instructions.
            path = f'/menu/{item["id"]}/{action}'
            with urllib.request.urlopen(public_url + path) as response:
                guide = response.read().decode()
                assert response.headers.get_content_type() == "text/plain"
            assert item["name"] in guide
            assert website.readable(item["install"]) in guide
            assert website.readable(item["remove"]) in guide
            assert "website cannot access local files" in guide
            assert "Installation and behavior verification are separate" in guide


def test_public_routes_never_fall_through_to_private_files_or_apis(public_url):
    for path in ("/setup/inspect", "/vibecheck/scan", "/recall/search", "/menu/unknown/",
                 "/menu/../catalog.json", "/api/corpus", "/api/setup", "/references/history.md",
                 "/src/usual/catalog.json", "/escape/../../README.md"):
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(public_url + path)
        assert error.value.code == 404
    for path in ("/", "/vibecheck/scan", "/api/setup"):
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(urllib.request.Request(public_url + path, data=b'{}'))
        assert error.value.code == 405


def test_catalog_content_is_escaped_in_generated_markup(monkeypatch):
    item = json.loads(json.dumps(website.items()[0]))
    item["benefit"] = '<script>alert("bad")</script>'
    item["example"] = '</pre><img src=x onerror="alert(1)">'
    monkeypatch.setattr(website, "items", lambda: [item])
    page = website.item_page(item["id"]).decode()
    assert '<script>alert("bad")</script>' not in page
    assert '<img src=x onerror=' not in page
    assert "&lt;script&gt;alert" in page
    assert "&lt;/pre&gt;&lt;img" in page


def test_synthetic_receipt_and_widget_are_available_without_private_state(public_url):
    with urllib.request.urlopen(public_url + "/flagship.json") as response:
        fixture = json.load(response)
    assert fixture["mode"] == "synthetic-fixture-replay"
    assert fixture["finding"]["sources"]
    assert fixture["finding"]["exceptions"]
    assert fixture["empty"]["findings"] == []
    assert {item["id"] for item in fixture["recipe"]["modules"]} == {"loops", "pop"}
    with urllib.request.urlopen(public_url + "/escape/demo/") as response:
        page = response.read().decode()
    assert "forced" in page.lower()
    assert "analytics:false,telemetry:false" in page
    with urllib.request.urlopen(public_url + "/escape/escape-webview.js") as response:
        asset = response.read()
    with urllib.request.urlopen(public_url + "/escape-widget.js") as response:
        assert response.read() == asset
    with urllib.request.urlopen(urllib.request.Request(public_url + "/menu/loops/", method="HEAD")) as response:
        assert response.status == 200
        assert int(response.headers["Content-Length"]) > 1000
        assert response.read() == b""


def test_pop_standalone_path_and_historical_choices_page_survive(public_url):
    with urllib.request.urlopen(public_url + "/pop/install") as response:
        assert response.headers.get_content_type() == "text/plain"
        assert "Usual Pop" in response.read().decode()
    with urllib.request.urlopen(public_url + "/pop/") as response:
        assert "googlechromes://tryusual.com" in response.read().decode()
    with urllib.request.urlopen(public_url + "/choices/legacy/") as response:
        assert "Local Memory for Claude Code and Codex" in response.read().decode()
