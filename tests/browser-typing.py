"""Exercise manual answers through real browser forms, offline, in all four configurations."""
import json
import os
from pathlib import Path
import re
import shutil

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.environ.get("QUIZ_SCREENSHOTS", "/tmp/englishwinner-screenshots"))
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def expected(entry, mode):
    return re.sub(r"\([^)]*\)", " ", entry["translation"].split(";")[0]).strip() if mode == "en-ru" else entry["word"]


with sync_playwright() as playwright:
    executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
    browser = playwright.chromium.launch(headless=True, **({"executable_path": executable} if executable else {}))
    context = browser.new_context(viewport={"width": 1280, "height": 1000}, offline=True)
    page = context.new_page()
    errors, remote_requests = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: remote_requests.append(request.url) if request.url.startswith(("http:", "https:")) else None)
    page.set_content((ROOT / "index.html").read_text(), wait_until="load")
    # Observe the real session to distinguish identical Russian prompts. All state
    # changes below use form submissions and buttons; no test hooks ship in the app.
    page.evaluate("""() => {
      const Original = Quiz.Session;
      Quiz.Session = class extends Original {
        constructor(...args) { super(...args); window.__typingSession = this; }
      };
    }""")
    page.locator("#answer-mode-choice").focus()
    page.keyboard.press("ArrowRight")
    assert page.locator("#answer-mode-typing").is_checked()
    assert "Введите" in page.locator("#rule-answer").inner_text()
    page.keyboard.press("ArrowLeft")
    assert page.locator("#answer-mode-choice").is_checked()

    def start(mode, test_format, answer_mode="typing"):
        if not page.locator("#intro").is_visible():
            page.locator("#change-mode-complete" if page.locator("#complete").is_visible() else "#change-mode").click()
        for name, value in [("mode", mode), ("format", test_format), ("answer-mode", answer_mode)]:
            page.locator(f'label:has(input[name="{name}"][value="{value}"])').click()
        page.locator("#start").click()
        assert page.locator("#training").is_visible()
        assert page.locator("#total-count").inner_text() == ("20" if test_format == "express" else "5000")
        assert page.locator("#correct-count").inner_text() == "0"
        assert page.locator("#mistake-count").inner_text() == "0"
        assert page.locator("#question-number").inner_text() == "1"
        assert page.locator("#typed-answer").input_value() == ""
        assert page.locator("#typed-outcome").is_hidden()
        if answer_mode == "typing":
            assert page.locator("#typed-form").is_visible()
            assert page.locator("#options").is_hidden()
            assert page.locator(".option").count() == 0
            assert page.locator("#next").is_hidden()
            assert page.evaluate("document.activeElement.id") == "typed-answer"
            assert page.locator("#typed-answer").get_attribute("lang") == ("ru" if mode == "en-ru" else "en")

    def entry():
        return page.evaluate("window.__typingSession.entry")

    # Enter, retries, skips, empty input and restart in each direction and length.
    for mode in ["en-ru", "ru-en"]:
        for test_format in ["full", "express"]:
            start(mode, test_format)
            first = entry()
            page.locator("#typed-answer").fill("___wrong___")
            page.locator("#typed-answer").press("Enter")
            assert entry()["word"] == first["word"]
            assert page.locator("#question-number").inner_text() == "1"
            assert page.locator("#correct-count").inner_text() == "0"
            assert page.locator("#mistake-count").inner_text() == "0"
            assert page.locator("#typed-answer").get_attribute("aria-invalid") == "true"
            assert page.locator("#typed-answer").evaluate("el => getComputedStyle(el).color") == "rgb(164, 44, 55)"
            if test_format == "express":
                page.screenshot(path=str(ARTIFACTS / f"typing-wrong-{mode}-desktop.png"), full_page=True)
            page.locator("#typed-answer").fill("  " + expected(first, mode).upper().replace("Ё", "Е") + "  ")
            page.locator("#typed-answer").press("Enter")
            assert page.locator("#question-number").inner_text() == "2"
            assert page.locator("#correct-count").inner_text() == "1"
            assert page.locator("#mistake-count").inner_text() == "0"
            assert page.locator("#typed-answer").input_value() == ""
            assert page.locator("#typed-answer").get_attribute("aria-invalid") is None
            assert "Верно" in page.locator("#typed-outcome").inner_text()
            assert page.evaluate("document.activeElement.id") == "typed-answer"
            second = entry()
            page.locator("#typed-answer").fill("___wrong___")
            page.locator("#check-answer").click()
            page.locator("#check-answer").click()
            assert entry()["word"] == second["word"]
            assert page.locator("#mistake-count").inner_text() == "0"
            page.locator("#skip-word").click()
            assert page.locator("#question-number").inner_text() == "3"
            assert page.locator("#correct-count").inner_text() == "1"
            assert page.locator("#mistake-count").inner_text() == "1"
            assert "Пропущено" in page.locator("#typed-outcome").inner_text()
            assert second["word"] in page.locator("#typed-outcome").inner_text()
            page.locator("#typed-answer").press("Enter")
            assert page.locator("#question-number").inner_text() == "3"
            assert page.locator("#mistake-count").inner_text() == "1"
            page.locator("#restart").click()
            assert page.locator("#question-number").inner_text() == "1"
            assert page.locator("#correct-count").inner_text() == "0"
            assert page.locator("#mistake-count").inner_text() == "0"
            assert page.locator("#typed-answer").input_value() == ""
            page.keyboard.type("1234")
            assert page.locator("#typed-answer").input_value() == "1234"
            assert page.locator("#correct-count").inner_text() == "0"

    # Complete each configuration. Correct answers auto-advance; skips are the
    # only failures. Bad attempts before a later correction must not lower scores.
    batch = r"""({start, count, total, mode}) => {
      const seen = [];
      let correct = 0, mistakes = 0;
      const form = document.getElementById('typed-form');
      const input = document.getElementById('typed-answer');
      const submit = value => { input.value = value; input.dispatchEvent(new Event('input', {bubbles: true})); form.requestSubmit(); };
      for (let i = start; i < Math.min(start + count, total); i++) {
        const current = window.__typingSession.entry;
        const prompt = mode === 'en-ru' ? current.word : current.translation.split(';')[0].trim();
        if (document.getElementById('word').textContent !== prompt) throw Error('Wrong prompt');
        if (document.getElementById('question-number').textContent !== String(i + 1)) throw Error('Wrong progress');
        const before = window.__typingSession.answered;
        seen.push(current.word);
        if (i % 4 <= 1) {
          submit('___wrong___'); submit('___wrong___');
          if (window.__typingSession.entry.word !== current.word || window.__typingSession.answered !== before) throw Error('Bad attempt advanced or scored');
          if (input.getAttribute('aria-invalid') !== 'true') throw Error('Error is not marked');
        }
        if (i % 4 === 1) {
          document.getElementById('skip-word').click(); mistakes++;
        } else {
          const meanings = current.translation.split(';').map(t => t.replace(/\([^)]*\)/g, '').trim()).filter(Boolean);
          submit('  ' + (mode === 'en-ru' ? meanings[meanings.length - 1] : current.word).toUpperCase().replaceAll('Ё', 'Е') + '  ');
          correct++;
        }
        if (window.__typingSession.answered !== i + 1) throw Error('Answer not scored once');
        if (i < total - 1) {
          if (document.getElementById('question-number').textContent !== String(i + 2)) throw Error('No automatic advance');
          if (input.value !== '') throw Error('Previous input was retained');
          if (document.activeElement !== input) throw Error('Lost input focus');
        }
      }
      return {seen, correct, mistakes};
    }"""
    processed = 0
    for mode in ["en-ru", "ru-en"]:
        for test_format in ["full", "express"]:
            start(mode, test_format)
            total = 20 if test_format == "express" else 5000
            seen, right, wrong = set(), 0, 0
            for offset in range(0, total, 200):
                result = page.evaluate(batch, {"start": offset, "count": 200, "total": total, "mode": mode})
                assert not seen.intersection(result["seen"])
                assert len(result["seen"]) == len(set(result["seen"]))
                seen.update(result["seen"])
                right += result["correct"]
                wrong += result["mistakes"]
                if len(seen) % 1000 == 0 or len(seen) == total:
                    print(f"typing {mode}, {test_format}: {len(seen)}/{total}", flush=True)
            assert len(seen) == total
            assert page.locator("#complete").is_visible()
            assert page.locator("#result-total").inner_text() == str(total)
            assert page.locator("#result-correct").inner_text() == str(right)
            assert page.locator("#result-mistakes").inner_text() == str(wrong)
            assert page.locator("#result-percent").inner_text() == "75%"
            assert page.locator("#result-answer-mode").inner_text() == "Ручной ввод"
            assert page.locator("#result-answer-mode").is_visible()
            page.screenshot(path=str(ARTIFACTS / f"typing-result-{mode}-{test_format}.png"), full_page=True)
            page.locator("#restart-complete").click()
            assert page.locator("#total-count").inner_text() == str(total)
            assert page.locator("#correct-count").inner_text() == "0"
            assert page.locator("#mistake-count").inner_text() == "0"
            assert page.locator("#typed-answer").input_value() == ""
            processed += total

    for width in [320, 390, 768, 1280]:
        page.set_viewport_size({"width": width, "height": 900})
        for mode in ["en-ru", "ru-en"]:
            for test_format in ["full", "express"]:
                start(mode, test_format)
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Overflow: {width}, {mode}, {test_format}"
                for control in ["#typed-answer", "#check-answer", "#skip-word"]:
                    assert page.locator(control).bounding_box()["height"] >= 44
                if width == 390 and test_format == "express":
                    page.screenshot(path=str(ARTIFACTS / f"typing-{mode}-mobile.png"), full_page=True)
                page.locator("#change-mode").click()
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                if width == 390:
                    page.screenshot(path=str(ARTIFACTS / "typing-welcome-mobile.png"), full_page=True)

    # Return to choices: they still require the explicit Next button.
    start("en-ru", "express", "choice")
    assert page.locator("#typed-form").is_hidden()
    assert page.locator(".option").count() == 4
    answer = entry()["translation"].split(";")[0].strip()
    index = page.locator(".option-text").all_text_contents().index(answer)
    page.locator(".option").nth(index).click()
    assert page.locator("#question-number").inner_text() == "1"
    assert page.locator("#correct-count").inner_text() == "1"
    page.locator("#next").click()
    assert page.locator("#question-number").inner_text() == "2"
    assert not errors, errors
    assert not remote_requests, remote_requests
    browser.close()
    print(json.dumps({"status": "passed", "typed_questions": processed,
                      "directions": ["en-ru", "ru-en"], "formats": ["full", "express"],
                      "viewports": [320, 390, 768, 1280], "browser_errors": errors,
                      "remote_requests": remote_requests, "screenshots": str(ARTIFACTS)}, ensure_ascii=False))
