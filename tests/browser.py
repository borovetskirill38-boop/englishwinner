"""Functional checks of the standalone HTML with networking offline.

The managed Chromium blocks file:// navigation by policy, so supply the exact
file contents through Playwright. No server or remote resources are involved.
"""
import json
import os
from pathlib import Path
import shutil

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.environ.get("QUIZ_SCREENSHOTS", "/tmp/englishwinner-screenshots"))
ARTIFACTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    chromium = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
    browser = playwright.chromium.launch(headless=True, **({"executable_path": chromium} if chromium else {}))
    context = browser.new_context(viewport={"width": 1280, "height": 1000}, offline=True)
    page = context.new_page()
    errors, remote_requests = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: remote_requests.append(request.url) if request.url.startswith(("http:", "https:")) else None)
    page.set_content((ROOT / "index.html").read_text(), wait_until="load")
    page.screenshot(path=str(ARTIFACTS / "welcome-desktop.png"), full_page=True)
    assert page.locator("#intro").is_visible()
    page.get_by_role("button", name="Начать тест").click()
    assert page.locator("#training").is_visible()
    assert page.locator(".option").count() == 4
    assert page.locator("#next").is_disabled()
    page.screenshot(path=str(ARTIFACTS / "question-desktop.png"), full_page=True)

    # Keyboard selection, error colors and protection against repeated answers.
    correct = page.evaluate("""() => {
      const data = JSON.parse(document.getElementById('vocabulary-data').textContent);
      const word = document.getElementById('word').textContent;
      return data.words.find(w => w.word === word).translation.split(';')[0].trim();
    }""")
    texts = page.locator(".option-text").all_text_contents()
    wrong = next(i for i, text in enumerate(texts) if text != correct)
    page.keyboard.press(str(wrong + 1))
    assert page.locator(".option.wrong").count() == 1
    assert page.locator(".option.correct").count() == 1
    assert page.locator(".option:disabled").count() == 4
    assert "Неправильно" in page.locator("#feedback").inner_text()
    assert correct in page.locator("#feedback-detail").inner_text()
    assert page.locator(".option.wrong").evaluate("e => getComputedStyle(e).color") == "rgb(164, 44, 55)"
    assert page.locator(".option.correct").evaluate("e => getComputedStyle(e).color") == "rgb(32, 100, 66)"
    page.keyboard.press("1")
    assert page.locator("#mistake-count").inner_text() == "1"
    page.screenshot(path=str(ARTIFACTS / "wrong-desktop.png"), full_page=True)
    page.keyboard.press("Enter")
    assert page.locator("#question-number").inner_text() == "2"
    assert page.locator("#next").is_disabled()
    page.locator("#restart").click()
    assert page.locator("#question-number").inner_text() == "1"
    assert page.locator("#mistake-count").inner_text() == "0"

    # Two entire passes via real button handlers: mixed answers, then a perfect pass.
    full_pass = """(mixed) => {
      const byWord = new Map(JSON.parse(document.getElementById('vocabulary-data').textContent)
        .words.map(w => [w.word, w.translation.split(';')[0].trim()]));
      const seen = new Set(), order = [];
      for (let i = 0; i < 2000; i++) {
        const word = document.getElementById('word').textContent;
        if (seen.has(word)) throw Error('Repeated word: ' + word + '; step=' + i
          + '; counter=' + document.getElementById('question-number').textContent
          + '; nextDisabled=' + document.getElementById('next').disabled);
        seen.add(word); order.push(word);
        if (document.getElementById('question-number').textContent !== String(i + 1)) throw Error('Wrong progress');
        const buttons = [...document.querySelectorAll('.option')];
        const texts = buttons.map(b => b.querySelector('.option-text').textContent);
        if (buttons.length !== 4 || new Set(texts).size !== 4) throw Error('Invalid choices');
        const answer = byWord.get(word);
        if (texts.filter(t => t === answer).length !== 1) throw Error('Missing or ambiguous correct answer');
        const expectedCorrect = !mixed || i % 2 === 0;
        buttons.find(b => (b.querySelector('.option-text').textContent === answer) === expectedCorrect).click();
        if (document.querySelectorAll('.option.correct').length !== 1) throw Error('Correct option not highlighted');
        if (document.querySelectorAll('.option.wrong').length !== (expectedCorrect ? 0 : 1)) throw Error('Wrong option state');
        const count = document.getElementById('correct-count').textContent;
        buttons[0].click();
        if (document.getElementById('correct-count').textContent !== count) throw Error('Double scoring');
        document.getElementById('next').click();
      }
      return order;
    }"""
    try:
        first_order = page.evaluate(full_pass, True)
    except Exception:
        print("Browser errors:", errors)
        page.screenshot(path=str(ARTIFACTS / "failure.png"), full_page=True)
        raise
    assert page.locator("#complete").is_visible()
    assert page.locator("#result-correct").inner_text() == "1000"
    assert page.locator("#result-mistakes").inner_text() == "1000"
    assert page.locator("#result-percent").inner_text() == "50%"
    page.screenshot(path=str(ARTIFACTS / "result-desktop.png"), full_page=True)
    page.locator("#restart-complete").click()
    second_order = page.evaluate(full_pass, False)
    assert first_order != second_order
    assert set(first_order) == set(second_order)
    assert page.locator("#result-percent").inner_text() == "100%"
    assert page.locator("#result-correct").inner_text() == "2000"
    assert page.locator("#result-mistakes").inner_text() == "0"
    assert "Ни одной ошибки" in page.locator("#result-message").inner_text()
    page.locator("#restart-complete").click()
    assert page.locator("#correct-count").inner_text() == "0"
    assert page.locator("#question-number").inner_text() == "1"

    # Narrow phones, tablet and desktop; answer buttons remain touch accessible.
    for width in [320, 390, 768, 1280]:
        page.set_viewport_size({"width": width, "height": 900})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Overflow at {width}px"
        page.locator(".brand").click()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Intro overflow at {width}px"
        if width == 390:
            page.screenshot(path=str(ARTIFACTS / "welcome-mobile.png"), full_page=True)
        page.locator("#start").click()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Quiz overflow at {width}px"
        for box in page.locator(".option").all():
            assert box.bounding_box()["height"] >= 44
        if width == 390:
            page.screenshot(path=str(ARTIFACTS / "question-mobile.png"), full_page=True)
        page.locator(".option").first.click()
        if width == 390:
            page.screenshot(path=str(ARTIFACTS / "answer-mobile.png"), full_page=True)

    assert not errors, errors
    assert not remote_requests, remote_requests
    browser.close()
    print(json.dumps({"status": "passed", "transport": "standalone HTML contents, offline",
                      "full_passes": 2, "questions": 4000,
                      "viewports": [320, 390, 768, 1280], "remote_requests": remote_requests,
                      "browser_errors": errors, "screenshots": str(ARTIFACTS)}, ensure_ascii=False))
