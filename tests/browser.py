"""Check both modes of the standalone HTML with networking offline.

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
COUNT = 3000

with sync_playwright() as playwright:
    chromium = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
    browser = playwright.chromium.launch(headless=True, **({"executable_path": chromium} if chromium else {}))
    context = browser.new_context(viewport={"width": 1280, "height": 1000}, offline=True)
    page = context.new_page()
    errors, remote_requests = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: remote_requests.append(request.url) if request.url.startswith(("http:", "https:")) else None)
    page.set_content((ROOT / "index.html").read_text(), wait_until="load")
    assert page.locator("#intro").is_visible()
    assert page.locator("#mode-en-ru").is_checked()
    # Native radio controls also work with a keyboard.
    page.locator("#mode-en-ru").focus()
    page.keyboard.press("ArrowRight")
    assert page.locator("#mode-ru-en").is_checked()
    page.keyboard.press("ArrowLeft")
    assert page.locator("#mode-en-ru").is_checked()
    page.screenshot(path=str(ARTIFACTS / "welcome-desktop.png"), full_page=True)

    def select_mode(mode):
        if not page.locator("#intro").is_visible():
            page.locator("#change-mode-complete" if page.locator("#complete").is_visible() else "#change-mode").click()
        page.locator(f'label:has(input[value="{mode}"])').click()
        assert page.locator(f'input[name="mode"][value="{mode}"]').is_checked()
        page.locator("#start").click()
        assert page.locator("#training").is_visible()
        assert page.locator("#question-number").inner_text() == "1"
        assert page.locator("#total-count").inner_text() == str(COUNT)
        assert page.locator("#word").get_attribute("lang") == ("ru" if mode == "ru-en" else "en")
        assert page.locator("#next").is_disabled()
        assert page.locator("#correct-count").inner_text() == "0"
        assert page.locator("#mistake-count").inner_text() == "0"
        assert page.locator(".option").count() == 4
        expected_lang = "en" if mode == "ru-en" else "ru"
        assert page.locator(f'.option-text[lang="{expected_lang}"]').count() == 4
        assert page.locator("#direction-from").inner_text() == ("RU" if mode == "ru-en" else "EN")
        assert page.locator("#direction-to").inner_text() == ("EN" if mode == "ru-en" else "RU")

    correct_answer = """(mode) => {
      const words = JSON.parse(document.getElementById('vocabulary-data').textContent).words;
      const primary = w => w.translation.split(';')[0].trim();
      const prompt = document.getElementById('word').textContent;
      if (mode === 'en-ru') return primary(words.find(w => w.word === prompt));
      const texts = [...document.querySelectorAll('.option-text')].map(e => e.textContent);
      const matches = words.filter(w => texts.includes(w.word) && primary(w) === prompt);
      if (matches.length !== 1) throw Error('Ambiguous reverse prompt: ' + prompt);
      return matches[0].word;
    }"""

    # Real key presses exercise feedback and the Enter handler in each direction.
    for mode in ["en-ru", "ru-en"]:
        select_mode(mode)
        page.screenshot(path=str(ARTIFACTS / f"question-{mode}-desktop.png"), full_page=True)
        correct = page.evaluate(correct_answer, mode)
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
        page.screenshot(path=str(ARTIFACTS / f"wrong-{mode}-desktop.png"), full_page=True)
        page.keyboard.press("Enter")
        assert page.locator("#question-number").inner_text() == "2"
        assert page.locator("#next").is_disabled()
        page.locator("#restart").click()
        assert page.locator("#question-number").inner_text() == "1"
        assert page.locator("#mistake-count").inner_text() == "0"
        assert page.locator("#word").get_attribute("lang") == ("ru" if mode == "ru-en" else "en")

    # Complete 3000 questions in each direction through actual button handlers.
    # Batches yield to the browser between checks without a long blocked evaluation.
    batch_pass = """({mode, mixed, start, count}) => {
      const data = JSON.parse(document.getElementById('vocabulary-data').textContent);
      const byWord = new Map(data.words.map(w => [w.word, w]));
      const primary = w => w.translation.split(';')[0].trim();
      const order = [];
      for (let i = start; i < Math.min(start + count, data.words.length); i++) {
        const prompt = document.getElementById('word').textContent;
        if (document.getElementById('question-number').textContent !== String(i + 1)) throw Error('Wrong progress');
        const buttons = [...document.querySelectorAll('.option')];
        const texts = buttons.map(b => b.querySelector('.option-text').textContent);
        if (buttons.length !== 4 || new Set(texts).size !== 4) throw Error('Invalid choices');
        let answer, word;
        if (mode === 'en-ru') {
          word = prompt; answer = primary(byWord.get(word));
        } else {
          const matches = texts.filter(t => byWord.has(t) && primary(byWord.get(t)) === prompt);
          if (matches.length !== 1) throw Error('Ambiguous reverse question: ' + prompt);
          word = matches[0]; answer = word;
        }
        order.push(word);
        if (texts.filter(t => t === answer).length !== 1) throw Error('Invalid correct answer');
        const expectedCorrect = !mixed || i % 2 === 0;
        buttons.find(b => (b.querySelector('.option-text').textContent === answer) === expectedCorrect).click();
        if (document.querySelectorAll('.option.correct').length !== 1) throw Error('Correct option not highlighted');
        if (document.querySelectorAll('.option.wrong').length !== (expectedCorrect ? 0 : 1)) throw Error('Wrong option state');
        const correctCount = document.getElementById('correct-count').textContent;
        buttons[0].click();
        if (document.getElementById('correct-count').textContent !== correctCount) throw Error('Double scoring');
        if (document.getElementById('next').disabled) throw Error('Next button disabled after answer');
        if (i === data.words.length - 1 && !document.getElementById('next').textContent.includes('Посмотреть результат')) throw Error('Missing finish action');
        document.getElementById('next').click();
      }
      return order;
    }"""
    orders = {}
    for mode in ["en-ru", "ru-en"]:
        select_mode(mode)
        collected = []
        try:
            for start in range(0, COUNT, 250):
                batch = page.evaluate(batch_pass, {"mode": mode, "mixed": mode == "en-ru", "start": start, "count": 250})
                assert not set(collected).intersection(batch), f"Repeated word in {mode}"
                assert len(set(batch)) == len(batch)
                collected.extend(batch)
                if len(collected) % 1000 == 0:
                    print(f"{mode}: {len(collected)}/{COUNT} questions checked", flush=True)
        except Exception:
            print("Browser errors:", errors)
            page.screenshot(path=str(ARTIFACTS / "failure.png"), full_page=True)
            raise
        assert len(collected) == COUNT
        orders[mode] = collected
        assert page.locator("#complete").is_visible()
        expected_correct = COUNT // 2 if mode == "en-ru" else COUNT
        assert page.locator("#result-correct").inner_text() == str(expected_correct)
        assert page.locator("#result-mistakes").inner_text() == str(COUNT - expected_correct)
        assert page.locator("#result-total").inner_text() == str(COUNT)
        assert page.locator("#result-percent").inner_text() == ("50%" if mode == "en-ru" else "100%")
        assert page.locator("#result-mode").inner_text() == ("Английский → русский" if mode == "en-ru" else "Русский → английский")
        page.screenshot(path=str(ARTIFACTS / f"result-{mode}-desktop.png"), full_page=True)
        page.locator("#restart-complete").click()
        assert page.locator("#correct-count").inner_text() == "0"
        assert page.locator("#question-number").inner_text() == "1"
        assert page.locator("#word").get_attribute("lang") == ("ru" if mode == "ru-en" else "en")
    assert set(orders["en-ru"]) == set(orders["ru-en"])
    assert orders["en-ru"] != orders["ru-en"]

    # Switch back from the reverse mode and verify a clean English question.
    select_mode("en-ru")
    assert page.locator("#word-note").inner_text() == "Выберите перевод на русский"
    assert page.locator(".option.correct, .option.wrong").count() == 0

    # Both modes on narrow phones, a tablet and desktop.
    for width in [320, 390, 768, 1280]:
        page.set_viewport_size({"width": width, "height": 900})
        for mode in ["en-ru", "ru-en"]:
            select_mode(mode)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Quiz overflow: {width}, {mode}"
            for box in page.locator(".option").all():
                assert box.bounding_box()["height"] >= 44
            if width == 390:
                page.screenshot(path=str(ARTIFACTS / f"question-{mode}-mobile.png"), full_page=True)
            page.locator(".option").first.click()
            if width == 390:
                page.screenshot(path=str(ARTIFACTS / f"answer-{mode}-mobile.png"), full_page=True)
            page.locator("#change-mode").click()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Intro overflow: {width}"
            if width == 390:
                page.screenshot(path=str(ARTIFACTS / "welcome-mobile.png"), full_page=True)

    assert not errors, errors
    assert not remote_requests, remote_requests
    browser.close()
    print(json.dumps({"status": "passed", "transport": "standalone HTML contents, offline",
                      "full_passes": 2, "questions": COUNT * 2, "modes": ["en-ru", "ru-en"],
                      "viewports": [320, 390, 768, 1280], "remote_requests": remote_requests,
                      "browser_errors": errors, "screenshots": str(ARTIFACTS)}, ensure_ascii=False))
