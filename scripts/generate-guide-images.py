#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
"""Regenerate documentation pictures from the built CLI and a running local service."""
import argparse
import html
from io import BytesIO
import json
import subprocess
from pathlib import Path

from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "images"
SAMPLE = ROOT / "examples" / "quickstart" / ".github" / "copilot-instructions.md"


def command(*args):
    result = subprocess.run(
        ["node", *args], cwd=ROOT, text=True, capture_output=True, check=True, timeout=30
    )
    return result.stdout.replace(str(ROOT), ".")


def verify_fonts(page, expected):
    page.evaluate("document.fonts.ready")
    client = page.context.new_cdp_session(page)
    try:
        client.send("DOM.enable")
        client.send("CSS.enable")
        root = client.send("DOM.getDocument")["root"]["nodeId"]
        for selector, family in expected.items():
            node = client.send("DOM.querySelector", {"nodeId": root, "selector": selector})["nodeId"]
            fonts = client.send("CSS.getPlatformFontsForNode", {"nodeId": node})["fonts"]
            actual = {font["familyName"] for font in fonts if font["glyphCount"]}
            assert family in actual, f"{selector} requires {family}; rendered fonts: {actual}"
    finally:
        client.detach()


def terminal(page, name, title, invocation, output):
    page.set_viewport_size({"width": 1024, "height": 200})
    lines = [line for line in output.splitlines()
             if not line.startswith("**Generated:") and "Timestamp:" not in line]
    page.set_content(f"""<!doctype html><html lang="en"><meta charset="utf-8">
    <style>
      * {{ box-sizing:border-box }}
      body {{ margin:0; background:#0b1220; color:#e2e8f0; padding:28px; }}
      h1 {{ font:600 24px Arial,sans-serif; margin:0 0 12px; }}
      p {{ font:15px Arial,sans-serif; color:#b4c2d3; margin:0 0 24px; }}
      pre {{ font:16px/1.6 Menlo,monospace; white-space:pre-wrap; overflow-wrap:anywhere;
             margin:0; padding:22px; background:#172235; border:1px solid #3a4d65; border-radius:12px; }}
      .command {{ color:#67e8f9 }}
    </style><body><h1>{html.escape(title)}</h1>
    <p>Real command output, excerpted. Local paths normalized; no files changed.</p>
    <pre><span class="command">$ {html.escape(invocation)}</span>

{html.escape(chr(10).join(lines).strip())}</pre></body></html>""")
    verify_fonts(page, {"h1": "Arial", "pre": "Menlo"})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path=str(OUT / name), full_page=True)


def feature_map(page):
    elements = []

    def element(kind, identifier, x, y, width, height, **extra):
        item = dict(type=kind, id=identifier, x=x, y=y, width=width, height=height,
                    angle=0, strokeColor="#000000", backgroundColor="transparent",
                    fillStyle="solid", strokeWidth=2, strokeStyle="solid", roughness=0,
                    opacity=100, groupIds=[], frameId=None, seed=len(elements) + 1,
                    version=1, versionNonce=len(elements) + 1, isDeleted=False,
                    boundElements=[], updated=1, link=None, locked=False)
        item.update(extra)
        elements.append(item)
        return item

    def text(identifier, x, y, width, value, size, container=None):
        return element("text", identifier, x, y, width, size * 2.5 * len(value.splitlines()),
                       text=value, originalText=value, fontSize=size, fontFamily=2,
                       textAlign="left", verticalAlign="top", containerId=container,
                       autoResize=False, lineHeight=2.5, baseline=size)

    text("title", 36, 18, 1060, "Choose the question. Run the matching assessment.", 30)
    text("subtitle", 36, 83, 1050, "Start with the stable scan. Add the other views only when you need them.", 17)
    cards = [
        ("scan", 36, "#0078D4", "#CFE4FA",
         "CONFIGURATION\nIs the setup healthy?\n... examples/quickstart\nScore + findings + CI gates\nStable"),
        ("advice", 400, "#5C2D91", "#E8DAEF",
         "STATIC ADVICE\nIs Copilot set up well?\n... . --copilot\n... . --experimental\nExperimental / not scored"),
        ("economics", 764, "#107C10", "#DFF6DD",
         "USAGE ACCOUNTING\nWhat did delivery cost?\n... economics usage.json\nBring usage + outcome data\nExperimental / no score"),
    ]
    for identifier, x, stroke, fill, value in cards:
        box = element("rectangle", identifier, x, 154, 328, 294,
                      strokeColor=stroke, backgroundColor=fill, roundness={"type": 3})
        label = text(identifier + "-label", x + 18, 185, 292, value, 18, identifier)
        box["boundElements"] = [{"type": "text", "id": label["id"]}]
        assert label["y"] + label["height"] <= box["y"] + box["height"]
    text("command-key", 36, 490, 1060, "... means: node dist/cli/index.js", 20)
    text("boundary", 36, 553, 1060,
         "Configuration scores are not bills. Experimental advice is not proof of savings.", 17)
    diagram = dict(type="excalidraw", version=2, source="cates",
                   elements=elements, appState={"viewBackgroundColor": "#ffffff"}, files={})
    (OUT / "feature-map.excalidraw").write_text(json.dumps(diagram, indent=2) + "\n")
    svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="1128" height="628" viewBox="0 0 1128 628">',
           '<title>CATES feature map</title>',
           '<desc>Stable configuration scanning, experimental static advice, and separate usage accounting.</desc>',
           '<rect width="1128" height="628" fill="white"/>']
    for item in elements:
        if item["type"] == "rectangle":
            svg.append(f'<rect x="{item["x"]}" y="{item["y"]}" width="{item["width"]}" '
                       f'height="{item["height"]}" rx="14" stroke="{item["strokeColor"]}" '
                       f'fill="{item["backgroundColor"]}" stroke-width="2"/>')
        else:
            for i, line in enumerate(item["text"].splitlines()):
                svg.append(f'<text x="{item["x"]}" y="{item["y"] + item["fontSize"] + i * item["fontSize"] * 2.5}" '
                           f'font-family="Arial,sans-serif" font-size="{item["fontSize"]}" fill="#000000">'
                           f'{html.escape(line)}</text>')
    svg.append("</svg>")
    source = "\n".join(svg) + "\n"
    (OUT / "feature-map.svg").write_text(source)
    page.set_viewport_size({"width": 1128, "height": 628})
    page.set_content('<body style="margin:0">' + source + "</body>")
    verify_fonts(page, {"text": "Arial"})
    assert page.evaluate("""() => [...document.querySelectorAll('text')].every(el => {
      const b = el.getBBox(); return b.x >= 0 && b.y >= 0 && b.x + b.width <= 1128 && b.y + b.height <= 628;
    })""")
    page.screenshot(path=str(OUT / "feature-map.png"))


def capture_ui(browser, base_url):
    page = browser.new_page(viewport={"width": 1024, "height": 900}, device_scale_factor=1)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(base_url, wait_until="networkidle")
    page.locator("#paste-content").fill(SAMPLE.read_text())
    page.locator("#paste-type").select_option(".github/copilot-instructions.md")
    page.locator("#paste-content").evaluate("el => { el.scrollTop = 0; el.setSelectionRange(0, 0); }")
    page.screenshot(path=str(OUT / "browser-start.png"), full_page=True)
    with page.expect_response("**/api/analyze") as response:
        page.locator("#run-paste").click()
    assert response.value.status == 200
    report = response.value.json()
    page.locator("#result").wait_for(state="visible")
    assert page.locator("#r-score").inner_text() == str(report["score"]["overall"])
    overview = page.locator("#result").bounding_box()
    dimensions = page.locator("#r-dimensions").bounding_box()
    assert overview and dimensions
    picture = Image.open(BytesIO(page.locator("#result").screenshot()))
    height = round(dimensions["y"] + dimensions["height"] - overview["y"] + 12)
    assert 0 < height <= picture.height
    picture.crop((0, 0, picture.width, height)).save(OUT / "browser-report.png")

    page.locator("#paste-type").select_option(".github/skills/review/SKILL.md")
    page.locator("#paste-content").fill("---\nname: wrong-name\n---\nReview the changes.")
    with page.expect_response("**/api/analyze") as response:
        page.locator("#run-paste").click()
    assert response.value.status == 200
    assert response.value.json()["copilot"]["scope"] == "supplied-files"
    page.locator("#r-copilot").wait_for(state="visible")
    page.locator("#r-copilot details").first.evaluate("el => el.open = true")
    page.locator("#r-copilot").screenshot(path=str(OUT / "copilot-report.png"))

    page.locator("#toggle-drawer").evaluate("el => el.open = true")
    page.locator("#copilot-target").select_option("cli")
    page.locator('input[data-rule="TE007"]').uncheck()
    page.locator("#export-yml").click()
    assert "TE007: off" in page.locator("#yml-text").inner_text()
    page.locator("#yml-preview").screenshot(path=str(OUT / "policy-export.png"))
    assert not errors, errors
    page.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    sample_before = SAMPLE.read_bytes()
    core = command("dist/cli/index.js", "examples/quickstart")
    economics = command("dist/cli/index.js", "economics", "examples/economics.json")
    optimization = command("dist/optimizer/cli.js", "examples/quickstart", "--dry-run",
                           "--only", "dedupe-lines,whitespace")
    assert SAMPLE.read_bytes() == sample_before
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1024, "height": 850}, device_scale_factor=1)
        terminal(page, "cli-scan.png", "Your first configuration report",
                 "node dist/cli/index.js examples/quickstart",
                 core.split("  ✨ Executive Summary:")[0] + "  📁 Files Discovered:"
                 + core.split("  📁 Files Discovered:")[1].split("  📉 Token Reduction Opportunity:")[0])
        terminal(page, "economics.png", "Cost per accepted task, not just tokens",
                 "node dist/cli/index.js economics examples/economics.json",
                 economics.split("\n  EXPERIMENTAL:")[0])
        terminal(page, "optimizer-preview.png", "Preview mechanical changes before writing",
                 "node dist/optimizer/cli.js examples/quickstart --dry-run --only dedupe-lines,whitespace",
                 "| Metric" + optimization.split("| Metric", 1)[1].split("\n\n", 1)[0])
        feature_map(page)
        capture_ui(browser, args.base_url)
        browser.close()
    print(f"Generated 8 PNGs, the editable feature map and its SVG in {OUT}")


if __name__ == "__main__":
    main()
