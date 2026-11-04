"""Complete all 24 combinations through browser handlers and verify frequency boundaries."""
import json
import os
from pathlib import Path
import shutil

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.environ.get("QUIZ_SCREENSHOTS", "/tmp/englishwinner-screenshots"))
ARTIFACTS.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
    browser = playwright.chromium.launch(headless=True, **({"executable_path": executable} if executable else {}))
    context = browser.new_context(viewport={"width": 1280, "height": 1000}, offline=True)
    page = context.new_page()
    errors, requests = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: requests.append(request.url) if request.url.startswith(("http:", "https:")) else None)
    page.set_content((ROOT / "index.html").read_text(), wait_until="load")
    # Observe the real session to disambiguate identical Russian prompts. No state
    # mutations use this reference, and no test hooks are included in the website.
    page.evaluate("""() => {
      const Original = Quiz.Session;
      Quiz.Session = class extends Original {
        constructor(...args) { super(...args); window.__levelSession = this; }
      };
    }""")

    def start(level, mode, test_format, answer_mode):
        for name, value in [("level", level), ("mode", mode), ("format", test_format), ("answer-mode", answer_mode)]:
            page.locator(f'label:has(input[name="{name}"][value="{value}"])').click()
        assert page.locator("#full-format-note").inner_text() == f"Все {level} слов"
        assert level in page.locator("#level-description").inner_text()
        page.locator("#start").click()
        assert page.locator("#training").is_visible()
        assert page.locator("#training-level").inner_text() == f"Уровень: {level} слов"
        assert page.locator("#total-count").inner_text() == ("20" if test_format == "express" else level)
        assert page.locator("#question-number").inner_text() == "1"

    batch = """({level, mode, answerMode, offset, count, total}) => {
      const words = JSON.parse(document.getElementById('vocabulary-data').textContent).words;
      const expected = words.slice(0, Number(level));
      const allowed = new Map(expected.map(entry => [entry.word, entry]));
      const session = window.__levelSession;
      if (session.level !== level || session.vocabularySize !== Number(level)) throw Error('Wrong level');
      if (session.vocabulary.some((entry, index) => entry.word !== expected[index].word)) throw Error('Wrong frequency prefix');
      const seen = [];
      for (let index = offset; index < Math.min(offset + count, total); index++) {
        const entry = session.entry;
        if (!allowed.has(entry.word)) throw Error('Question outside frequency level: ' + entry.word);
        seen.push(entry.word);
        if (document.getElementById('question-number').textContent !== String(index + 1)) throw Error('Wrong progress');
        if (document.getElementById('total-count').textContent !== String(total)) throw Error('Wrong total');
        const correct = index % 4 !== 1;
        if (answerMode === 'choice') {
          const buttons = [...document.querySelectorAll('.option')];
          if (buttons.length !== 4 || new Set(buttons.map(button => button.textContent)).size !== 4) throw Error('Invalid options');
          session.options.forEach((option, optionIndex) => {
            const source = allowed.get(option.word);
            if (!source) throw Error('Option outside frequency level: ' + option.word);
            const label = mode === 'ru-en' ? source.word : source.translation.split(';')[0].trim();
            if (option.text !== label || buttons[optionIndex].querySelector('.option-text').textContent !== label) throw Error('Wrong option translation');
          });
          const answer = session.options.findIndex(option => option.correct === correct);
          buttons[answer].click();
          if (document.querySelectorAll('.option.correct').length !== 1) throw Error('Missing correct highlight');
          if (document.querySelectorAll('.option.wrong').length !== (correct ? 0 : 1)) throw Error('Missing wrong highlight');
          const answered = session.answered;
          buttons[answer].click();
          if (session.answered !== answered) throw Error('Double scoring');
          document.getElementById('next').click();
        } else {
          const input = document.getElementById('typed-answer');
          const form = document.getElementById('typed-form');
          input.value = '___wrong___';
          form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
          if (session.index !== index || session.answered !== index || !input.classList.contains('is-wrong')) throw Error('Wrong retry behavior');
          if (!correct) document.getElementById('skip-word').click();
          else {
            input.value = mode === 'ru-en' ? entry.word : entry.translation.split(';')[0].replace(/\\([^)]*\\)/g, ' ').trim();
            input.dispatchEvent(new Event('input', {bubbles: true}));
            form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
            if (!document.getElementById('typed-outcome').textContent.startsWith('Верно:')) throw Error('No correct outcome');
          }
        }
        if (session.index !== index + 1 || session.answered !== index + 1) throw Error('No advance or wrong scoring');
      }
      return seen;
    }"""

    configurations, questions = 0, 0
    for level in ["1000", "3000", "5000"]:
        for mode in ["en-ru", "ru-en"]:
            for test_format in ["full", "express"]:
                for answer_mode in ["choice", "typing"]:
                    start(level, mode, test_format, answer_mode)
                    total = 20 if test_format == "express" else int(level)
                    seen = set()
                    for offset in range(0, total, 200):
                        words = page.evaluate(batch, {"level": level, "mode": mode, "answerMode": answer_mode,
                                                      "offset": offset, "count": 200, "total": total})
                        assert len(words) == len(set(words))
                        assert not seen.intersection(words)
                        seen.update(words)
                    assert len(seen) == total
                    assert page.locator("#complete").is_visible()
                    assert page.locator("#result-total").inner_text() == str(total)
                    assert page.locator("#result-correct").inner_text() == str(total * 3 // 4)
                    assert page.locator("#result-mistakes").inner_text() == str(total // 4)
                    assert page.locator("#result-percent").inner_text() == "75%"
                    assert level in page.locator("#result-level").inner_text()
                    if test_format == "express":
                        assert f"20 случайных слов из {level}" in page.locator("#completion-note").inner_text()
                    page.locator("#restart-complete").click()
                    assert page.locator("#question-number").inner_text() == "1"
                    assert page.locator("#correct-count").inner_text() == "0"
                    assert page.locator("#training-level").inner_text() == f"Уровень: {level} слов"
                    page.locator("#change-mode").click()
                    assert page.locator(f'input[name="level"][value="{level}"]').is_checked()
                    questions += total
                    configurations += 1
                    print(f"level {level}, {mode}, {test_format}, {answer_mode}: {total} passed", flush=True)

    for width in [320, 390, 768, 1280]:
        page.set_viewport_size({"width": width, "height": 900})
        for level in ["1000", "3000", "5000"]:
            start(level, "ru-en", "express", "typing")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.locator("#change-mode").click()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            for selector in ['label:has(input[name="level"])', "#change-mode"]:
                for label in page.locator(selector).all():
                    if label.is_visible():
                        assert label.bounding_box()["height"] >= 44
            if width == 390:
                page.screenshot(path=str(ARTIFACTS / f"levels-{level}-mobile.png"), full_page=True)
    assert not errors, errors
    assert not requests, requests
    browser.close()
    print(json.dumps({"status": "passed", "engine": "Chromium", "configurations": configurations,
                      "completedQuestions": questions, "frequencyBoundaries": "passed",
                      "remoteRequests": requests, "errors": errors}))
