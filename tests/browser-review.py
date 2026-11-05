"""Verify express mistake review, actual controls, topic meanings and clean restarts offline."""
import json
import os
from pathlib import Path
import shutil

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path(os.environ.get("QUIZ_SCREENSHOTS", "/tmp/englishwinner-screenshots"))
ARTIFACTS.mkdir(parents=True, exist_ok=True)
HTML = (ROOT / "index.html").read_text()
OBSERVER = """() => {
  const Original = Quiz.Session;
  Quiz.Session = class extends Original {
    constructor(...args) { super(...args); window.__reviewSession = this; }
  };
}"""

# All answers go through production DOM handlers. Only the observer above reads
# the active session to disambiguate identical Russian prompts and synonyms.
BATCH = """scenario => {
  const $ = id => document.getElementById(id);
  const session = window.__reviewSession;
  const source = JSON.parse($('vocabulary-data').textContent).words;
  const allowed = new Map(source.slice(0, Number(session.level))
    .filter(entry => session.topic === 'all' || entry.topics.includes(session.topic))
    .map(entry => {
      const meanings = entry.topicTranslations && entry.topicTranslations[session.topic];
      return [entry.word, meanings ? meanings.join('; ') : entry.translation];
    }));
  const expected = [];
  const submit = value => {
    $('typed-answer').value = value;
    $('typed-answer').dispatchEvent(new Event('input', {bubbles: true}));
    $('typed-form').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
  };
  while (!session.finished) {
    const index = session.index;
    const entry = session.entry;
    if (allowed.get(entry.word) !== entry.translation) throw Error('Question outside selected topic/level');
    const row = session.mode === 'en-ru' ? [entry.word, entry.translation] : [Quiz.primaryTranslation(entry), entry.word];
    const answer = session.mode === 'en-ru' ? Quiz.translationVariants(entry)[0] : entry.word;
    let incorrect = false;
    if (session.answerMode === 'choice') {
      incorrect = scenario === 'all-wrong' || (scenario === 'mixed' && (index % 3 === 0 || index === session.total - 1));
      const button = $('options').children[session.options.findIndex(option => option.correct !== incorrect)];
      button.click(); button.click();
      if (!$('complete').hidden) throw Error('Choice completed before next');
      $('next').click();
    } else if (scenario === 'all-correct') {
      submit(answer);
    } else {
      const pattern = index === session.total - 1 ? 1 : index % 4;
      incorrect = scenario === 'all-wrong' || pattern === 1 || pattern === 2;
      submit('...');
      if (pattern === 2) {
        $('skip-word').click();
      } else {
        submit('___wrong___'); submit('___wrong___');
        if (session.index !== index || session.mistakes !== expected.length) throw Error('Early retries were scored');
        submit(incorrect ? '___wrong___' : answer);
        if (incorrect) {
          if (!$('complete').hidden || session.index !== index) throw Error('Exhaustion auto-advanced');
          submit(answer); $('skip-word').click();
          if (session.mistakes !== expected.length + 1) throw Error('Repeated submission changed result');
          $('next').click();
        }
      }
    }
    if (incorrect) expected.push(row);
    if (session.index !== index + 1) throw Error('Question was skipped or repeated');
  }
  if ($('complete').hidden || $('mistake-review').hidden) throw Error('Missing express review');
  const rows = Array.from($('mistake-review-list').children).map(row => Array.from(row.children).map(cell => cell.textContent));
  if (JSON.stringify(rows) !== JSON.stringify(expected)) throw Error('Review differs from scored mistakes: ' + JSON.stringify({rows, expected}));
  if (Number($('result-mistakes').textContent) !== expected.length || session.mistakes !== expected.length) throw Error('Review count differs from score');
  if ($('mistake-review-table').hidden !== (expected.length === 0)) throw Error('Wrong empty table state');
  if (!expected.length && !$('mistake-review-message').textContent.includes('Все ответы верные')) throw Error('Missing perfect-score message');
  for (const row of $('mistake-review-list').children) {
    if (row.children[0].lang !== Quiz.MODES[session.mode].questionLang || row.children[1].lang !== Quiz.MODES[session.mode].answerLang) throw Error('Wrong review language');
  }
  return {total: session.total, mistakes: expected.length};
}"""

with sync_playwright() as playwright:
    executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
    browser = playwright.chromium.launch(headless=True, **({"executable_path": executable} if executable else {}))
    errors, requests = [], []

    def open_page(context, html=HTML, legacy=False):
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: requests.append(request.url) if request.url.startswith(("http:", "https:")) else None)
        if legacy:
            page.evaluate("Object.hasOwn = undefined; String.prototype.replaceAll = undefined; Element.prototype.replaceChildren = undefined;")
        page.set_content(html, wait_until="load")
        page.evaluate(OBSERVER)
        return page

    def start(page, level, topic, mode, answer_mode, test_format="express", touch=False):
        for name, value in [("level", level), ("mode", mode), ("format", test_format), ("answer-mode", answer_mode)]:
            control = page.locator(f'label:has(input[name="{name}"][value="{value}"])')
            control.tap() if touch else control.click()
        page.locator("#topic").select_option(topic)
        page.locator("#start").tap() if touch else page.locator("#start").click()
        assert page.locator("#mistake-review").is_hidden()
        assert page.locator("#mistake-review-list tr").count() == 0

    context = browser.new_context(viewport={"width": 1280, "height": 1000}, offline=True)
    page = open_page(context)
    topics = page.evaluate("Object.keys(Quiz.TOPICS)")
    configurations = questions = 0
    for level in ["1000", "3000", "5000"]:
        for topic in topics:
            for mode in ["en-ru", "ru-en"]:
                for answer_mode in ["choice", "typing"]:
                    start(page, level, topic, mode, answer_mode)
                    result = page.evaluate(BATCH, "mixed")
                    assert result["total"] == min(20, page.evaluate("window.__reviewSession.vocabularySize"))
                    assert 0 < result["mistakes"] < result["total"]
                    questions += result["total"]
                    page.locator("#change-mode-complete").click()
                    configurations += 1
            print(f"review level {level}, {topic}: both directions and answer modes passed", flush=True)

    # The same result screen must clear a previous list and handle a perfect pass.
    for mode in ["en-ru", "ru-en"]:
        for answer_mode in ["choice", "typing"]:
            start(page, "1000", "food", mode, answer_mode)
            page.evaluate(BATCH, "all-wrong")
            page.locator("#restart-complete").click()
            assert page.locator("#mistake-review").is_hidden()
            assert page.locator("#mistake-review-list tr").count() == 0
            assert page.evaluate("window.__reviewSession.incorrectWords.length") == 0
            page.evaluate(BATCH, "all-correct")
            page.locator("#change-mode-complete").click()
    context.close()

    # Real touch/keyboard interactions with all 20 words incorrect; the final
    # question must appear in the review just like earlier skipped/exhausted words.
    mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, offline=True)
    touch = open_page(mobile)
    for mode in ["en-ru", "ru-en"]:
        for answer_mode in ["choice", "typing"]:
            start(touch, "5000", "all", mode, answer_mode, touch=True)
            expected = []
            for index in range(20):
                expected.append(touch.evaluate("""() => {
                  const s = window.__reviewSession;
                  return s.mode === 'en-ru' ? [s.entry.word, s.entry.translation] : [s.prompt, s.entry.word];
                }"""))
                if answer_mode == "choice":
                    wrong = touch.evaluate("window.__reviewSession.options.findIndex(option => !option.correct)")
                    touch.locator(".option").nth(wrong).tap()
                    touch.locator("#next").tap()
                elif index % 2 == 0:
                    touch.locator("#skip-word").tap()
                else:
                    touch.locator("#typed-answer").fill("___wrong___")
                    for _ in range(3):
                        touch.locator("#typed-answer").press("Enter")
                    assert touch.locator("#complete").is_hidden()
                    touch.locator("#next").tap()
            assert touch.locator("#complete").is_visible()
            assert touch.locator("#result-mistakes").inner_text() == "20"
            actual = touch.locator("#mistake-review-list tr").evaluate_all("rows => rows.map(row => Array.from(row.children).map(cell => cell.textContent))")
            assert actual == expected
            for width in [320, 390, 768, 1280]:
                touch.set_viewport_size({"width": width, "height": 844})
                assert touch.evaluate("document.documentElement.scrollWidth <= innerWidth")
            touch.set_viewport_size({"width": 390, "height": 844})
            if answer_mode == "typing":
                touch.locator("#mistake-review").scroll_into_view_if_needed()
                touch.screenshot(path=str(ARTIFACTS / f"review-{mode}-mobile.png"), full_page=True)
            touch.locator("#change-mode-complete").tap()
    mobile.close()

    # A real topic-qualified word in a one-word pool checks last-word completion,
    # short express tests, the full-test exclusion and older Safari API fallbacks.
    marker = '<script id="vocabulary-data" type="application/json">'
    before, remainder = HTML.split(marker, 1)
    embedded, after = remainder.split('</script>', 1)
    data = json.loads(embedded)
    for entry in data["words"]:
        entry["topics"] = ["time"] if entry["word"] == "date" else ["basics"]
    fixture = before + marker + json.dumps(data, ensure_ascii=False) + '</script>' + after
    small = browser.new_context(viewport={"width": 320, "height": 844}, offline=True)
    single = open_page(small, fixture, legacy=True)
    assert single.evaluate("[Object.hasOwn, String.prototype.replaceAll, Element.prototype.replaceChildren].every(value => value === undefined)")
    for mode in ["en-ru", "ru-en"]:
        for test_format in ["express", "full"]:
            start(single, "1000", "time", mode, "typing", test_format)
            assert single.locator("#total-count").inner_text() == "1"
            single.locator("#typed-answer").fill("___wrong___")
            for _ in range(3):
                single.locator("#typed-answer").press("Enter")
            assert single.locator("#complete").is_hidden()
            single.locator("#next").click()
            assert single.locator("#complete").is_visible()
            assert single.locator("#result-mistakes").inner_text() == "1"
            if test_format == "express":
                assert single.locator("#mistake-review").is_visible()
                expected = [["date", "дата"]] if mode == "en-ru" else [["дата", "date"]]
                actual = single.locator("#mistake-review-list tr").evaluate_all("rows => rows.map(row => Array.from(row.children).map(cell => cell.textContent))")
                assert actual == expected
            else:
                assert single.locator("#mistake-review").is_hidden()
                assert single.locator("#mistake-review-list tr").count() == 0
            single.locator("#change-mode-complete").click()
    small.close()
    assert not errors, errors
    assert not requests, requests
    browser.close()
    print(json.dumps({"status": "passed", "engine": "Chromium", "expressConfigurations": configurations,
                      "matrixQuestions": questions, "perfectAndRestart": "passed", "mobileAllWrong": "passed",
                      "topicMeaningAndSmallPool": "passed", "fullTestExclusion": "passed", "errors": errors, "remoteRequests": requests}))
