"""Read-only public collection pages, generated from the versioned tool catalog.

This module reads packaged public assets only. It never opens a runtime store.
"""
from __future__ import annotations

import html
import json
from importlib.resources import files
from typing import Any

SITE = "https://tryusual.com"
REPO = "https://github.com/pauljump/usual"


def catalog() -> dict[str, Any]:
    return json.loads(files("usual").joinpath("catalog.json").read_text(encoding="utf-8"))


def items() -> list[dict[str, Any]]:
    data = catalog()
    return data["items"] if isinstance(data, dict) else data


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def readable(value: Any) -> str:
    if isinstance(value, list):
        return "\n".join(readable(part) for part in value)
    if isinstance(value, dict) and not value:
        return "No additional settings. Select the scope explicitly when a command requires it."
    if isinstance(value, dict):
        return "\n".join(f"{key.replace('_', ' ')}: {readable(part)}" for key, part in value.items())
    return str(value)


def menu_rows() -> str:
    return "".join(
        f'<a class="menu-row" href="/menu/{esc(item["id"])}/">'
        f'<span class="menu-number">{int(item.get("number", index)):02}</span>'
        f'<span class="menu-info"><span class="menu-title">{esc(item["name"])}</span>'
        f'<span class="menu-benefit">{esc(item["benefit"])}</span></span>'
        '<span class="menu-dots" aria-hidden="true"></span>'
        f'<span class="menu-maturity">{esc(item["maturity"])}</span>'
        '<span class="menu-arrow" aria-hidden="true">↗</span></a>'
        for index, item in enumerate(items(), 1)
    )


def homepage() -> bytes:
    template = files("usual").joinpath("collection.html").read_text(encoding="utf-8")
    return template.replace("<!-- CATALOG_MENU -->", menu_rows()).encode("utf-8")


def navigation() -> str:
    return ('<a class="skip-link" href="#main">Skip to content</a><div class="wrap">'
            '<header class="site-header"><a class="brand" href="/" aria-label="Usual home">'
            '<span class="brand-mark" aria-hidden="true">u</span>usual<span class="brand-period">.</span></a>'
            '<nav aria-label="Main navigation"><a href="/#menu">Menu</a>'
            '<a href="/#example">Example</a>'
            f'<a class="github-link" href="{REPO}">GitHub <span aria-hidden="true">↗</span></a>'
            '</nav></header></div>')


def footer() -> str:
    return ('<footer class="site-footer wrap"><a class="brand" href="/">usual.</a>'
            '<span>Make yourself at home.</span><div><a href="/privacy/">Privacy</a>'
            '<a href="/catalog.json">Catalog</a><a href="/learn.md">Agent guide</a>'
            f'<a href="{REPO}">Open source · MIT ↗</a></div></footer>'
            '<div id="notice" class="toast" role="status" aria-live="polite"></div>')


def head(title: str, description: str, path: str) -> str:
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="theme-color" content="#f5f2e9">'
            f'<title>{esc(title)}</title><meta name="description" content="{esc(description)}">'
            f'<link rel="canonical" href="{SITE}{esc(path)}">'
            '<link rel="stylesheet" href="/collection.css"><link rel="icon" href="/mark.svg" type="image/svg+xml">'
            '<meta property="og:site_name" content="Usual"><meta property="og:type" content="article">'
            f'<meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(description)}">'
            f'<meta property="og:url" content="{SITE}{esc(path)}">'
            f'<meta property="og:image" content="{SITE}/collection-og.png">'
            '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
            '<meta property="og:image:alt" content="Usual. Your AI, how you like it.">'
            '<meta name="twitter:card" content="summary_large_image">'
            f'<meta name="twitter:title" content="{esc(title)}"><meta name="twitter:description" content="{esc(description)}">'
            f'<meta name="twitter:image" content="{SITE}/collection-og.png">'
            '<meta name="twitter:image:alt" content="Usual. Your AI, how you like it.">'
            '<script src="/collection.js" defer></script></head>')


def item_page(item_id: str) -> bytes:
    item = next(item for item in items() if item["id"] == item_id)
    source = item["source"]
    title = f'{item["name"]} · Usual'
    prompt = f'Read https://tryusual.com/{item_id}/install and help me install {item["name"]}. Show me what changes and how to remove it. Do not import history unless I select a scope.'
    if item_id == "pop":
        prompt = "Read https://tryusual.com/pop/install and install it. Help me choose my browser, preserve unrelated instructions, and show me how to remove Pop."
    example = readable(item["example"])
    content = [head(title, item["benefit"], f"/menu/{item_id}/"), '<body>', navigation(),
               '<main id="main" class="wrap item-main">',
               '<div class="breadcrumbs"><a href="/#menu">The menu</a><span>/</span>' + esc(item["name"]) + '</div>',
               '<section class="item-hero"><div>',
               f'<p class="eyebrow">No. {int(item["number"]):02} / {esc(item["maturity"])}</p>',
               f'<h1>{esc(item["name"])}<span class="orange">.</span></h1>',
               f'<p class="item-lede">{esc(item["benefit"])}</p>',
               '<div class="actions"><a class="button primary" href="#install">Install <span aria-hidden="true">↗</span></a>',
               f'<a class="button secondary" href="/{item_id}/use">Read the use guide</a></div>',
               '<p class="micro">Choose this tool on its own. No Usual account required.</p></div>',
               '<aside class="item-example"><div class="receipt-top"><span>ON THE MENU</span><span>↳ AN EXAMPLE</span></div>',
               f'<h2>{esc(item["name"])} in practice</h2><pre>{esc(example)}</pre>',
               '<div class="receipt-bottom">ILLUSTRATIVE EXAMPLE · INSPECT BEFORE USE</div></aside></section>',
               '<div class="item-layout"><div class="item-body">',
               '<section id="install"><p class="eyebrow">01 / Make it yours</p><h2>Start with one useful thing.</h2>',
               '<p>On the computer where you use your coding agent, paste this prompt. Read the instructions before installing.</p>',
               f'<div class="prompt-box"><textarea id="item-prompt" readonly aria-label="Install prompt">{esc(prompt)}</textarea>',
               '<button class="button primary" data-copy-target="item-prompt">Copy install prompt ↗</button></div>',
               '<details class="instruction-details" open><summary>Inspect the local install commands</summary>',
               '<p>Run these from an inspected Usual source checkout or extracted <a href="/usual.zip">source bundle</a>. Paths are examples; select your own scope.</p>',
               f'<pre>{esc(readable(item["install"]))}</pre></details></section>',
               '<section id="use"><p class="eyebrow">02 / Put it to work</p><h2>Use it. See the result.</h2>',
               f'<pre>{esc(readable(item["use"]))}</pre>',
               f'<p class="muted"><a href="/{item_id}/use">Plain-text instructions for your agent ↗</a></p></section>',
               '<section id="adjust"><p class="eyebrow">03 / Keep it your way</p><h2>Inspect, edit, remove.</h2>',
               '<h3>Configuration</h3>',
               f'<pre>{esc(readable(item["configuration"]))}</pre>',
               '<h3>Disable or remove</h3>', f'<pre>{esc(readable(item["remove"]))}</pre>',
               '<p>Review the change first. Preserve unrelated instructions and original history.</p></section>',
               '</div><aside class="tool-facts">',
               '<p class="eyebrow">The particulars</p><h3>Know what you’re ordering.</h3>',
               '<dl>']
    for label, value in [("Status", item["maturity"]), ("Environments", item["supported_environments"]),
                         ("Requirements", item["requirements"]), ("Storage", item.get("storage", "See storage/network below.")),
                         ("Network", item.get("network", item.get("storage_network", "See the source instructions."))),
                         ("Verification", item["verification"])]:
        content.append(f'<dt>{esc(label)}</dt><dd>{esc(readable(value))}</dd>')
    content.extend(['</dl>', '<div class="source-note"><p class="eyebrow">Source & attribution</p>',
                    f'<a href="{esc(source["url"])}">{esc(source["url"].replace("https://github.com/", ""))} ↗</a>',
                    f'<p>{esc(source["license"])} · {esc(source["version"])}</p>',
                    f'<p><a href="{REPO}">Contribute through pauljump/usual ↗</a></p></div>',
                    '</aside></div>'])
    if item_id == "escape":
        content.insert(content.index('</div><aside class="tool-facts">'),
                       '<section><h2>See the visitor experience.</h2><p>The forced example shows the interstitial on desktop. It does not prove a browser escape on your device.</p><a class="button secondary" href="/escape/demo/">Try the widget example ↗</a></section>')
    if item_id == "pop":
        content.insert(content.index('</div><aside class="tool-facts">'),
                       '<section><h2>Try the link formats.</h2><p>Browser handling depends on your device and client. A generated link alone is not a verified browser launch.</p><a class="button secondary" href="/pop/">Open the original Pop example ↗</a></section>')
    content.extend(['<section class="next-tool"><p class="eyebrow">À la carte, always</p><h2>A little more your usual.</h2><a class="button secondary" href="/#menu">Browse all six tools ↗</a></section>',
                    '</main>', footer(), '</body></html>'])
    return "".join(content).encode("utf-8")


def agent_guide(item_id: str, action: str) -> bytes:
    item = next(item for item in items() if item["id"] == item_id)
    sections = [f'# Usual {item["name"]} — {action}', item["benefit"],
                f'Source: {REPO}\nCatalog: {SITE}/catalog.json\nHuman page: {SITE}/menu/{item_id}/',
                'Use an inspected Usual source checkout or extracted source bundle: https://tryusual.com/usual.zip. Run commands from its root. Python 3.11+ for the local runtime.',
                'This website cannot access local files or connect to your agent. These are instructions for the current coding agent. Select explicit source/scope paths with the user. Current instructions control authority; history is not permission. No extra model service or background monitor is required.']
    for label in (["requirements", "install", "configuration", "use", "remove", "storage", "network", "verification", "source"]):
        if label in item:
            sections.append(f'## {label.replace("_", " ").title()}\n\n{readable(item[label])}')
    sections.append('Installation and behavior verification are separate. Report exactly what was inspected, changed, and tested. Do not claim live agent or device behavior from a deterministic test. Preserve unrelated user changes. Evidence read by a hosted coding agent uses that provider’s normal processing and usage. The local runtime has no telemetry.')
    return "\n\n".join(sections).encode("utf-8")


def escape_demo() -> bytes:
    content = [head("Escape widget example · Usual", "A forced example of the Escape visitor interstitial. Device behavior is not verified by this example.", "/escape/demo/"),
               '<body>', navigation(), '<main id="main" class="wrap escape-demo-page"><p class="eyebrow">No. 06 / Forced desktop example</p>',
               '<h1>Take the outside route<span class="orange">.</span></h1>',
               '<p class="item-lede">Escape helps a website’s visitors leave an in-app browser.</p>',
               '<p>This button deliberately displays the interstitial here, including in a normal desktop browser. It demonstrates the interface, not a successful browser escape or device support.</p>',
               '<button id="show-escape" class="button primary">Show the widget ↗</button><p id="escape-status" role="status"></p>',
               '<p><a href="/menu/escape/">Back to Escape’s install guide</a></p>',
               '<p class="micro">Pinned upstream Escape Webview v1.0.0 · MIT · Analytics and telemetry disabled.</p></main>',
               footer(), '<script src="/escape/escape-webview.js"></script>',
               '<script>document.getElementById("show-escape").addEventListener("click",function(){if(!window.EscapeWebview){document.getElementById("escape-status").textContent="The widget could not load. Reload this page to try again.";return;}window.EscapeWebview.init({force:true,auto:false,url:location.href,name:"Usual demo",analytics:false,telemetry:false});document.getElementById("escape-status").textContent="Forced example opened. This is not device verification.";});</script>', '</body></html>']
    return "".join(content).encode("utf-8")
