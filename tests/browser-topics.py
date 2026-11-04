"""Check every themed configuration, frequency boundaries, native controls and small pools."""
import json
import math
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
    catalog = page.evaluate("Quiz.TOPICS")
    page.evaluate("""() => {
      const Original = Quiz.Session;
      Quiz.Session = class extends Original {
        constructor(...args) { super(...args); window.__topicSession = this; }
      };
    }""")

    def start(level, topic, mode, test_format, answer_mode):
        for name, value in [("level", level), ("mode", mode), ("format", test_format), ("answer-mode", answer_mode)]:
            page.locator(f'label:has(input[name="{name}"][value="{value}"])').click()
        page.locator("#topic").select_option(topic)
        count = page.evaluate("""({level, topic}) => JSON.parse(document.getElementById('vocabulary-data').textContent)
          .words.slice(0, Number(level)).filter(entry => topic === 'all' || entry.topics.includes(topic)).length""", {"level": level, "topic": topic})
        assert count > 0
        assert str(count) in page.locator("#full-format-note").inner_text()
        assert str(count) in page.locator(f'#topic option[value="{topic}"]').inner_text()
        assert page.locator("#start").is_enabled()
        page.locator("#start").click()
        assert page.locator("#training-level").inner_text() == f"Уровень: {level} слов"
        assert page.locator("#training-topic").inner_text() == catalog[topic]
        total = count if test_format == "full" else min(20, count)
        assert page.locator("#total-count").inner_text() == str(total)
        return total, count

    batch = """({level, topic, mode, answerMode, offset, count, total}) => {
      const source = JSON.parse(document.getElementById('vocabulary-data').textContent).words;
      const expected = source.slice(0, Number(level)).filter(entry => entry.topics.includes(topic)).map(entry => {
        const meanings = entry.topicTranslations && entry.topicTranslations[topic];
        return meanings ? Object.assign({}, entry, {translation: meanings.join('; '), aliases: []}) : entry;
      });
      const allowed = new Map(expected.map(entry => [entry.word, entry]));
      const session = window.__topicSession;
      if (session.level !== level || session.topic !== topic || session.levelSize !== Number(level)) throw Error('Wrong selection');
      if (session.vocabularySize !== expected.length || session.vocabulary.some((entry, index) => entry.word !== expected[index].word)) throw Error('Topic was filtered before level cutoff');
      const seen = [];
      for (let index = offset; index < Math.min(offset + count, total); index++) {
        const entry = session.entry;
        if (!allowed.has(entry.word)) throw Error('Question leaked from another topic or level: ' + entry.word);
        seen.push(entry.word);
        if (document.getElementById('question-number').textContent !== String(index + 1)) throw Error('Wrong counter');
        const correct = index % 2 === 0;
        if (answerMode === 'choice') {
          const buttons = [...document.querySelectorAll('.option')];
          if (buttons.length !== 4 || new Set(buttons.map(button => button.textContent)).size !== 4) throw Error('Invalid choices');
          session.options.forEach((option, optionIndex) => {
            const sourceEntry = allowed.get(option.word);
            if (!sourceEntry) throw Error('Answer option leaked from another topic or level: ' + option.word);
            const text = mode === 'ru-en' ? sourceEntry.word : sourceEntry.translation.split(';')[0].trim();
            if (buttons[optionIndex].querySelector('.option-text').textContent !== text) throw Error('Wrong answer text');
          });
          const answer = session.options.findIndex(option => option.correct === correct);
          buttons[answer].click();
          if (document.querySelectorAll('.option.correct').length !== 1) throw Error('Missing correct highlight');
          if (document.querySelectorAll('.option.wrong').length !== (correct ? 0 : 1)) throw Error('Missing wrong highlight');
          document.getElementById('next').click();
        } else {
          const input = document.getElementById('typed-answer');
          const form = document.getElementById('typed-form');
          input.value = '___wrong___';
          form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
          if (session.index !== index || session.answered !== index || input.getAttribute('aria-invalid') !== 'true') throw Error('Wrong retry handling');
          if (!correct) document.getElementById('skip-word').click();
          else {
            input.value = mode === 'ru-en' ? entry.word : entry.translation.split(';')[0].replace(/\\([^)]*\\)/g, ' ').trim();
            input.dispatchEvent(new Event('input', {bubbles: true}));
            form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
            if (!document.getElementById('typed-outcome').textContent.startsWith('Верно:')) throw Error('Missing correct outcome');
          }
        }
        if (session.index !== index + 1 || session.answered !== index + 1) throw Error('Incorrect advance or score');
      }
      return seen;
    }"""

    configurations, questions = 0, 0
    for level in ["1000", "3000", "5000"]:
        for topic in [topic for topic in catalog if topic != "all"]:
            for mode in ["en-ru", "ru-en"]:
                for test_format in ["full", "express"]:
                    for answer_mode in ["choice", "typing"]:
                        total, available = start(level, topic, mode, test_format, answer_mode)
                        seen = set()
                        for offset in range(0, total, 200):
                            result = page.evaluate(batch, {"level": level, "topic": topic, "mode": mode,
                                "answerMode": answer_mode, "offset": offset, "count": 200, "total": total})
                            assert len(result) == len(set(result))
                            assert not seen.intersection(result)
                            seen.update(result)
                        assert len(seen) == total
                        assert page.locator("#complete").is_visible()
                        assert page.locator("#result-total").inner_text() == str(total)
                        assert page.locator("#result-correct").inner_text() == str(math.ceil(total / 2))
                        assert page.locator("#result-mistakes").inner_text() == str(total // 2)
                        assert page.locator("#result-percent").inner_text() == f"{math.floor(math.ceil(total / 2) / total * 100 + 0.5)}%"
                        assert level in page.locator("#result-level").inner_text()
                        assert catalog[topic] in page.locator("#result-topic").inner_text()
                        if available < 20: assert total == available
                        page.locator("#restart-complete").click()
                        assert page.locator("#question-number").inner_text() == "1"
                        assert page.locator("#correct-count").inner_text() == "0"
                        assert page.locator("#total-count").inner_text() == str(total)
                        assert page.locator("#training-topic").inner_text() == catalog[topic]
                        page.locator("#change-mode").click()
                        assert page.locator("#topic").input_value() == topic
                        configurations += 1
                        questions += total
            print(f"topics level {level}: {topic} passed (all eight modes)", flush=True)

    for width in [320, 390, 768, 1280]:
        page.set_viewport_size({"width": width, "height": 900})
        for level in ["1000", "3000", "5000"]:
            for topic in ["home", "family", "work", "food", "leisure", "all"]:
                total, _ = start(level, topic, "ru-en", "express", "typing")
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                if width == 390 and level == "1000" and topic == "food":
                    page.screenshot(path=str(ARTIFACTS / "topic-food-1000-training-mobile.png"), full_page=True)
                page.locator("#change-mode").click()
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                assert page.locator("#topic").bounding_box()["height"] >= 44
                if width == 390 and topic == "food":
                    page.screenshot(path=str(ARTIFACTS / f"topic-food-{level}-mobile.png"), full_page=True)

    # An empty lower-level intersection must remain empty rather than importing
    # words from a higher level. This fixture changes only test-page metadata.
    start_marker = '<script id="vocabulary-data" type="application/json">'
    before, remainder = HTML.split(start_marker, 1)
    embedded, after = remainder.split('</script>', 1)
    for low_count in [0, 1]:
        data = json.loads(embedded)
        for index, entry in enumerate(data['words'][:1000]):
            entry['topics'] = [topic for topic in entry['topics'] if topic != 'food']
            if index < low_count: entry['topics'].append('food')
        fixture = context.new_page()
        fixture.on("pageerror", lambda error: errors.append(str(error)))
        fixture.set_content(before + start_marker + json.dumps(data, ensure_ascii=False).replace('<', '\\u003c') + '</script>' + after)
        fixture.locator('#topic').select_option('food')
        fixture.locator('label:has(input[name="level"][value="1000"])').click()
        assert fixture.locator('#topic').input_value() == 'food'
        assert fixture.locator('#start').is_disabled()
        if low_count == 0:
            assert 'нет слов' in fixture.locator('#topic-description').inner_text()
        else:
            assert 'ручной ввод' in fixture.locator('#topic-description').inner_text()
            fixture.locator('label:has(input[name="answer-mode"][value="typing"])').click()
            assert fixture.locator('#start').is_enabled()
            fixture.locator('#start').click()
            assert fixture.locator('#total-count').inner_text() == '1'
            fixture.locator('#typed-answer').fill(data['words'][0]['translation'].split(';')[0])
            fixture.locator('#check-answer').click()
            assert fixture.locator('#result-total').inner_text() == '1'
        fixture.close()
    assert not errors, errors
    assert not requests, requests
    browser.close()
    print(json.dumps({"status": "passed", "engine": "Chromium", "configurations": configurations,
                      "completedQuestions": questions, "topicAndLevelBoundaries": "passed",
                      "emptyAndSmallSelections": "passed", "remoteRequests": requests, "errors": errors}))
