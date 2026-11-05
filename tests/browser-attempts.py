"""Exercise three-attempt learning feedback in every typing configuration and on touch screens."""
import json
import os
from pathlib import Path
import shutil

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.environ.get("QUIZ_SCREENSHOTS", "/tmp/englishwinner-screenshots"))
ARTIFACTS.mkdir(parents=True, exist_ok=True)
HTML = (ROOT / "index.html").read_text()

with sync_playwright() as playwright:
    executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
    browser = playwright.chromium.launch(headless=True, **({"executable_path": executable} if executable else {}))
    context = browser.new_context(viewport={"width": 1280, "height": 1000}, offline=True)
    page = context.new_page()
    errors, requests = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: requests.append(request.url) if request.url.startswith(("http:", "https:")) else None)
    page.set_content(HTML, wait_until="load")
    page.evaluate("""() => {
      const Original = Quiz.Session;
      Quiz.Session = class extends Original {
        constructor(...args) { super(...args); window.__attemptSession = this; }
      };
    }""")
    topics = page.evaluate("Object.keys(Quiz.TOPICS)")

    batch = """() => {
      const session = window.__attemptSession;
      const input = document.getElementById('typed-answer');
      const form = document.getElementById('typed-form');
      const next = document.getElementById('next');
      const check = document.getElementById('check-answer');
      const skip = document.getElementById('skip-word');
      const feedback = document.getElementById('feedback');
      const source = JSON.parse(document.getElementById('vocabulary-data').textContent).words;
      const allowed = new Set(source.slice(0, Number(session.level))
        .filter(entry => session.topic === 'all' || entry.topics.includes(session.topic)).map(entry => entry.word));
      const attempts = remaining => {
        if (document.getElementById('typing-attempts').textContent !== `Осталось попыток: ${remaining} из 3`) throw Error('Wrong attempts display');
      };
      const submit = value => {
        input.value = value;
        input.dispatchEvent(new Event('input', {bubbles: true}));
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
      };
      const correct = () => session.mode === 'ru-en' ? session.entry.word
        : session.entry.translation.split(';')[0].replace(/\\([^)]*\\)/g, ' ').trim();
      attempts(3);
      submit(''); submit('...');
      attempts(3);
      if (session.answered !== 0) throw Error('Empty input was scored');
      if (!allowed.has(session.entry.word)) throw Error('Question outside selection');
      submit('___wrong___'); attempts(2);
      submit('___wrong___'); attempts(1);
      if (session.index !== 0 || session.answered !== 0 || !next.hidden) throw Error('Early retry advanced or revealed');
      if (feedback.classList.contains('has-answer')) throw Error('Answer revealed before third failure');
      submit(correct()); attempts(3);
      if (session.index !== 1 || session.correct !== 1 || session.mistakes !== 0) throw Error('Third attempt success was not correct');
      const failed = session.entry;
      submit('___wrong___'); submit('___wrong___'); submit('___wrong___'); attempts(0);
      const expected = session.mode === 'ru-en' ? session.prompt + ' — ' + failed.word : failed.word + ' — ' + failed.translation;
      if (document.getElementById('feedback-detail').textContent !== expected) throw Error('Wrong contextual answer revealed');
      if (!feedback.classList.contains('is-wrong') || !feedback.classList.contains('has-answer')) throw Error('Missing exhausted state');
      if (session.index !== 1 || session.answered !== 2 || session.mistakes !== 1 || session.selected !== 'exhausted') throw Error('Third failure advanced or scored incorrectly');
      if (!input.disabled || !check.disabled || !skip.disabled || next.hidden || next.disabled) throw Error('Wrong controls after reveal');
      const revealed = document.getElementById('feedback-detail').textContent;
      submit(correct()); submit('___wrong___'); skip.click();
      if (session.index !== 1 || session.mistakes !== 1 || document.getElementById('feedback-detail').textContent !== revealed) throw Error('Revealed answer was changed or rescored');
      if (!feedback.classList.contains('has-answer')) throw Error('Input event hid the correct answer');
      next.click(); attempts(3);
      if (session.index !== 2 || input.disabled || check.disabled || skip.disabled || !next.hidden) throw Error('Controls were not reset on next word');
      if (feedback.classList.contains('has-answer') || input.value !== '') throw Error('Answer leaked to next word');
      if (!allowed.has(session.entry.word)) throw Error('Next question outside selection');
      submit('___wrong___'); skip.click(); attempts(3);
      if (session.index !== 3 || session.mistakes !== 2) throw Error('Early skip no longer works');
      submit(correct()); attempts(3);
      if (session.index !== 4 || session.correct !== 2 || session.mistakes !== 2) throw Error('Normal correct answer no longer works');
      document.getElementById('restart').click(); attempts(3);
      if (session === window.__attemptSession || window.__attemptSession.answered !== 0 || input.disabled || check.disabled || skip.disabled) throw Error('Restart did not reset attempts');
    }"""

    configurations = 0
    for level in ["1000", "3000", "5000"]:
        for topic in topics:
            for mode in ["en-ru", "ru-en"]:
                for test_format in ["full", "express"]:
                    for name, value in [("level", level), ("mode", mode), ("format", test_format), ("answer-mode", "typing")]:
                        page.locator(f'label:has(input[name="{name}"][value="{value}"])').click()
                    page.locator("#topic").select_option(topic)
                    page.locator("#start").click()
                    page.evaluate(batch)
                    page.locator("#change-mode").click()
                    configurations += 1
            print(f"attempts level {level}, {topic}: both directions and formats passed", flush=True)

    # Actual mobile taps and Enter presses, including a held Enter key before
    # and after exhaustion, must preserve the displayed answer until a fresh action.
    mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, offline=True)
    touch = mobile.new_page()
    touch.on("pageerror", lambda error: errors.append(str(error)))
    touch.set_content(HTML, wait_until="load")
    for mode in ["en-ru", "ru-en"]:
        for test_format in ["full", "express"]:
            for name, value in [("level", "1000"), ("mode", mode), ("format", test_format), ("answer-mode", "typing")]:
                touch.locator(f'label:has(input[name="{name}"][value="{value}"])').tap()
            touch.locator("#topic").select_option("food")
            touch.locator("#start").tap()
            word = touch.locator("#word").inner_text()
            touch.locator("#typed-answer").fill("___wrong___")
            touch.keyboard.down("Enter")
            touch.keyboard.down("Enter")
            touch.keyboard.up("Enter")
            assert touch.locator("#typing-attempts").inner_text() == "Осталось попыток: 2 из 3"
            touch.locator("#typed-answer").press("Enter")
            assert touch.locator("#typing-attempts").inner_text() == "Осталось попыток: 1 из 3"
            touch.keyboard.down("Enter")
            touch.keyboard.down("Enter")
            touch.keyboard.up("Enter")
            assert touch.locator("#typing-attempts").inner_text() == "Осталось попыток: 0 из 3"
            assert touch.locator("#word").inner_text() == word
            assert touch.locator("#question-number").inner_text() == "1"
            assert touch.locator("#mistake-count").inner_text() == "1"
            assert touch.locator("#typed-answer").is_disabled()
            assert touch.locator("#typed-answer").evaluate("el => getComputedStyle(el).color") == "rgb(164, 44, 55)"
            assert touch.locator("#feedback.has-answer").is_visible()
            assert touch.locator("#next").is_enabled()
            assert touch.evaluate("document.documentElement.scrollWidth <= innerWidth")
            if test_format == "express":
                touch.screenshot(path=str(ARTIFACTS / f"attempts-revealed-{mode}-mobile.png"), full_page=True)
            touch.keyboard.press("Enter")
            assert touch.locator("#question-number").inner_text() == "2"
            assert touch.locator("#typing-attempts").inner_text() == "Осталось попыток: 3 из 3"
            assert touch.locator("#typed-answer").is_enabled()
            touch.locator("#restart").tap()
            assert touch.locator("#question-number").inner_text() == "1"
            assert touch.locator("#mistake-count").inner_text() == "0"
            touch.locator("#change-mode").tap()
    mobile.close()

    # A single-word theme exercises exhaustion on the final question: results
    # remain hidden until the learner explicitly continues after studying it.
    marker = '<script id="vocabulary-data" type="application/json">'
    before, remainder = HTML.split(marker, 1)
    embedded, after = remainder.split('</script>', 1)
    data = json.loads(embedded)
    for index, entry in enumerate(data['words']):
        entry['topics'] = ['home'] if index == 0 else []
    fixture_html = before + marker + json.dumps(data, ensure_ascii=False).replace('<', '\\u003c') + '</script>' + after
    for mode in ["en-ru", "ru-en"]:
        for test_format in ["full", "express"]:
            fixture = context.new_page()
            fixture.on("pageerror", lambda error: errors.append(str(error)))
            fixture.set_content(fixture_html, wait_until="load")
            for name, value in [("level", "1000"), ("mode", mode), ("format", test_format), ("answer-mode", "typing")]:
                fixture.locator(f'label:has(input[name="{name}"][value="{value}"])').click()
            fixture.locator('#topic').select_option('home')
            fixture.locator('#start').click()
            fixture.locator('#typed-answer').fill('___wrong___')
            for attempt in range(3): fixture.locator('#typed-answer').press('Enter')
            assert fixture.locator('#complete').is_hidden()
            assert fixture.locator('#feedback.has-answer').is_visible()
            assert fixture.locator('#next').inner_text() == 'Посмотреть результат'
            assert fixture.locator('#mistake-count').inner_text() == '1'
            fixture.keyboard.press('Enter')
            assert fixture.locator('#complete').is_visible()
            assert fixture.locator('#result-total').inner_text() == '1'
            assert fixture.locator('#result-correct').inner_text() == '0'
            assert fixture.locator('#result-mistakes').inner_text() == '1'
            fixture.locator('#restart-complete').click()
            assert fixture.locator('#typing-attempts').inner_text() == 'Осталось попыток: 3 из 3'
            assert fixture.locator('#typed-answer').is_enabled()
            fixture.close()

    assert not errors, errors
    assert not requests, requests
    browser.close()
    print(json.dumps({"status": "passed", "engine": "Chromium", "typingConfigurations": configurations,
                      "thirdFailureReveal": "passed", "mobileEnterAndTouch": "passed", "finalWord": "passed",
                      "errors": errors, "remoteRequests": requests}))
