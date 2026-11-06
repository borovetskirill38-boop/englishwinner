"""Check accepted Russian variants and sense boundaries through the actual offline UI."""
import json
import os
from pathlib import Path
import shutil

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text()
CASES = [
    ("all", "ladies", ["леди", "дамы"], "дама"),
    ("people", "ladies", ["леди", "дамы"], "дама"),
    ("all", "lady", ["леди", "дама"], "дамы"),
    ("all", "doctor", ["доктор"], "доктора"),
    ("all", "doctors", ["доктора"], "доктор"),
    ("all", "friends", ["подруги"], "подруга"),
    ("all", "cousin", ["кузен", "кузина"], "сосед"),
    ("all", "white", ["белая", "белые"], "российский"),
    ("all", "saw", ["видела", "видели"], "пил"),
    ("space", "left", ["левая"], "ушла"),
    ("all", "card", ["карта", "карточка"], "картинка"),
    ("all", "proof", ["доказательство", "подтверждение"], "сомнение"),
    ("law", "evidence", ["доказательство", "улика"], "догадка"),
    ("nature", "bank", ["берег", "берег реки"], "банк"),
    ("work", "book", ["забронировать", "резервировать"], "книжка"),
    ("time", "watch", ["часы", "наручные часы"], "наблюдать"),
    ("family", "card", ["открытка", "поздравительная открытка"], "карта"),
    ("food", "can", ["банка", "консервная банка"], "уметь"),
    ("law", "fine", ["штраф", "денежное взыскание"], "прекрасный"),
    ("food", "date", ["финик"], "свидание"),
    ("time", "may", ["май"], "мочь"),
    ("technology", "drive", ["диск", "привод"], "ехать"),
]

with sync_playwright() as playwright:
    executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
    browser = playwright.chromium.launch(headless=True, **({"executable_path": executable} if executable else {}))
    errors, requests = [], []
    context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, offline=True)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: requests.append(request.url) if request.url.startswith(("http:", "https:")) else None)
    page.set_content(HTML, wait_until="load")
    # Only control the random draw: every answer and transition still uses the UI.
    page.evaluate("""() => {
      const Original = Quiz.Session;
      Quiz.Session = class extends Original {
        constructor(...args) {
          const pool = Quiz.wordsForTopic(Quiz.wordsForLevel(args[0], args[6]), args[7]);
          const target = pool.findIndex(entry => entry.word === window.__synonymTarget);
          if (target < 0) throw Error('Target is not in selected level and topic');
          let remaining = pool.length;
          args[2] = () => { remaining -= 1; return remaining === target ? 0 : 1 - Number.EPSILON; };
          super(...args);
          window.__synonymSession = this;
        }
      };
    }""")

    def start(level, topic, word, test_format, mode="en-ru"):
        page.evaluate("word => { window.__synonymTarget = word; }", word)
        for name, value in [("level", level), ("mode", mode), ("format", test_format), ("answer-mode", "typing")]:
            page.locator(f'label:has(input[name="{name}"][value="{value}"])').tap()
        page.locator("#topic").select_option(topic)
        page.locator("#start").tap()
        assert page.evaluate("window.__synonymSession.entry.word") == word

    configurations = answers = 0
    for level in ["1000", "3000", "5000"]:
        allowed = set(page.evaluate("""level => JSON.parse(document.getElementById('vocabulary-data').textContent).words.slice(0, Number(level)).map(entry => entry.word)""", level))
        for topic, word, accepted, rejected in CASES:
            if word not in allowed:
                continue
            for test_format in ["full", "express"]:
                start(level, topic, word, test_format)
                for answer in accepted:
                    if answers and page.locator("#question-number").inner_text() != "1":
                        page.locator("#restart").tap()
                    assert page.locator("#word").inner_text() == word
                    page.locator("#typed-answer").fill(answer.upper())
                    page.locator("#typed-answer").press("Enter")
                    assert page.locator("#correct-count").inner_text() == "1", (level, topic, word, answer)
                    assert page.locator("#mistake-count").inner_text() == "0"
                    assert page.locator("#question-number").inner_text() == "2"
                    assert page.locator("#typing-attempts").inner_text() == "Осталось попыток: 3 из 3"
                    answers += 1
                page.locator("#restart").tap()
                page.locator("#typed-answer").fill(rejected)
                page.locator("#typed-answer").press("Enter")
                assert page.locator("#question-number").inner_text() == "1"
                assert page.locator("#typed-answer").get_attribute("aria-invalid") == "true"
                assert page.locator("#typing-attempts").inner_text() == "Осталось попыток: 2 из 3"
                page.locator("#typed-answer").fill(accepted[0])
                page.locator("#typed-answer").press("Enter")
                assert page.locator("#correct-count").inner_text() == "1"
                assert page.locator("#mistake-count").inner_text() == "0"
                assert page.locator("#question-number").inner_text() == "2"
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                page.locator("#change-mode").tap()
                configurations += 1
        print(f"synonyms level {level}: accepted variants, retries, both formats and topic boundaries passed", flush=True)

    # The new Russian aliases must not import an English synonym from level 3000
    # into level 1000, even when the user enters a semantically correct word.
    for level in ["1000", "3000", "5000"]:
        for test_format in ["full", "express"]:
            start(level, "law", "evidence", test_format, "ru-en")
            page.locator("#typed-answer").fill("proof")
            page.locator("#typed-answer").press("Enter")
            if level == "1000":
                assert page.locator("#question-number").inner_text() == "1"
                page.locator("#typed-answer").fill("evidence")
                page.locator("#typed-answer").press("Enter")
            assert page.locator("#correct-count").inner_text() == "1"
            assert page.locator("#mistake-count").inner_text() == "0"
            assert page.locator("#question-number").inner_text() == "2"
            page.locator("#change-mode").tap()
    assert not errors, errors
    assert not requests, requests
    context.close()
    browser.close()
    print(json.dumps({"status": "passed", "engine": "Chromium", "russianConfigurations": configurations,
                      "acceptedVariantChecks": answers, "reverseLevelAndTopicChecks": 6,
                      "nativeTouchAndEnter": "passed", "errors": errors, "remoteRequests": requests}))
