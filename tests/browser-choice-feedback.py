"""Check wrong-choice translations in every level, direction, format and topic."""
import json
import os
from pathlib import Path
import shutil

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

with sync_playwright() as playwright:
    executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
    browser = playwright.chromium.launch(headless=True, **({"executable_path": executable} if executable else {}))
    context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, offline=True)
    page = context.new_page()
    errors, requests = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: requests.append(request.url) if request.url.startswith(("http:", "https:")) else None)
    page.set_content((ROOT / "index.html").read_text(), wait_until="load")
    page.evaluate("""() => {
      const Original = Quiz.Session;
      Quiz.Session = class extends Original {
        constructor(...args) { super(...args); window.choiceSession = this; }
      };
      const byWord = new Map(JSON.parse(document.getElementById('vocabulary-data').textContent).words.map(entry => [entry.word, entry]));
      const el = id => document.getElementById(id);
      window.checkChoice = (condition, message) => { if (!condition) throw Error(message); };
      window.choiceExpected = correct => {
        const session = window.choiceSession;
        const index = session.options.findIndex(option => option.correct === correct);
        const option = session.options[index];
        const entry = byWord.get(option.word);
        const meanings = entry.topicTranslations && entry.topicTranslations[session.topic];
        const translation = meanings ? meanings.join('; ') : entry.translation;
        checkChoice(entry.rank <= byWord.get([...byWord.keys()][Number(session.level) - 1]).rank, 'Choice is outside level');
        checkChoice(session.topic === 'all' || entry.topics.includes(session.topic), 'Choice is outside topic');
        const pair = session.mode === 'ru-en' ? `${option.text} — ${translation}` : `${option.text} — ${entry.word}`;
        const prompt = session.entry;
        const correctPair = session.mode === 'ru-en' ? `${prompt.translation} — ${prompt.word}` : `${prompt.word} — ${prompt.translation}`;
        return { index, selected: `Вы выбрали: ${pair}`, correct: `Правильный ответ: ${correctPair}` };
      };
      window.checkChoiceReset = () => {
        checkChoice(el('feedback-selected').hidden, 'Old selected translation is visible');
        checkChoice(el('feedback-selected').textContent === '', 'Old selected translation was retained');
        checkChoice(el('feedback-detail').textContent === '', 'Old correct answer was retained');
      };
      window.checkWrongChoice = expected => {
        checkChoice(!el('feedback-selected').hidden, 'Selected translation is hidden');
        checkChoice(el('feedback-selected').textContent === expected.selected, 'Wrong selected translation');
        checkChoice(el('feedback-detail').textContent === expected.correct, 'Wrong correct answer');
        checkChoice(el('options').children[expected.index].classList.contains('wrong'), 'Wrong choice is not red');
        checkChoice(el('options').querySelectorAll('.correct').length === 1, 'Correct choice is not highlighted');
        checkChoice([...el('options').children].every(button => button.disabled), 'Choices are still enabled');
        checkChoice(el('mistake-count').textContent === '1', 'Wrong mistake count');
        checkChoice(el('question-number').textContent === '1', 'Question advanced before next');
        el('options').children[expected.index].click();
        checkChoice(el('mistake-count').textContent === '1', 'Repeated choice was counted');
        checkChoice(el('feedback-selected').textContent === expected.selected, 'Translation did not remain visible');
        checkChoice(document.documentElement.scrollWidth <= innerWidth, 'Mobile horizontal overflow');
      };
    }""")

    def start(level, topic, mode, test_format, answer_mode="choice"):
        page.evaluate("""settings => {
          for (const [name, value] of Object.entries(settings)) {
            if (name === 'topic') continue;
            document.querySelector(`input[name="${name}"][value="${value}"]`).click();
          }
          const topic = document.getElementById('topic');
          topic.value = settings.topic;
          topic.dispatchEvent(new Event('change', {bubbles: true}));
          document.getElementById('start').click();
          checkChoice(!document.getElementById('training').hidden, 'Test did not start');
          checkChoiceReset();
        }""", {"level": level, "topic": topic, "mode": mode, "format": test_format, "answer-mode": answer_mode})

    topics = page.evaluate("Object.keys(Quiz.TOPICS)")
    configurations = native = 0
    for level in ["1000", "3000", "5000"]:
        for mode in ["en-ru", "ru-en"]:
            for test_format in ["full", "express"]:
                for topic in topics:
                    start(level, topic, mode, test_format)
                    expected = page.evaluate("choiceExpected(false)")
                    if topic == "all":
                        page.locator(".option").nth(expected["index"]).tap()
                        page.evaluate("checkWrongChoice", expected)
                        page.locator("#next").press("Enter")
                        native += 1
                    else:
                        page.evaluate("""expected => {
                          document.getElementById('options').children[expected.index].click();
                          checkWrongChoice(expected);
                          document.getElementById('next').click();
                        }""", expected)
                    page.evaluate("""() => {
                      checkChoiceReset();
                      const correct = choiceExpected(true);
                      document.getElementById('options').children[correct.index].click();
                      checkChoice(document.getElementById('feedback-selected').hidden, 'Wrong-choice feedback shown for correct answer');
                      checkChoice(document.getElementById('correct-count').textContent === '1', 'Correct answer not counted');
                      checkChoice(document.getElementById('mistake-count').textContent === '1', 'Mistake count changed');
                      document.getElementById('change-mode').click();
                    }""")
                    configurations += 1
        print(f"choice feedback level {level}: both directions, formats and all topics passed", flush=True)

    start("1000", "all", "en-ru", "express", "typing")
    page.locator("#typed-answer").fill("неправильный вариант")
    page.locator("#typed-answer").press("Enter")
    assert page.locator("#feedback-selected").is_hidden()
    assert page.locator("#typing-attempts").inner_text() == "Осталось попыток: 2 из 3"
    assert not errors, errors
    assert not requests, requests
    context.close()
    browser.close()
    print(json.dumps({"status": "passed", "engine": "Chromium", "choiceConfigurations": configurations,
                      "nativeTouchAndEnter": native, "errors": errors, "remoteRequests": requests}))
