"""Exercise the separate phrase quizzes and real navigation without remote requests."""
import json
import os
from pathlib import Path
import shutil
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://englishwinner.test/"
ARTIFACTS = Path(os.environ.get("QUIZ_SCREENSHOTS", "/tmp/englishwinner-phrases-screenshots"))
ARTIFACTS.mkdir(parents=True, exist_ok=True)

HOOKS = r"""() => {
  const Original = PhraseQuiz.Session;
  PhraseQuiz.Session = class extends Original {
    constructor(...args) { super(...args); window.phraseSession = this; }
  };
  const el = id => document.getElementById(id);
  const data = JSON.parse(el('phrase-data').textContent);
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const normalized = text => text.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  window.beginPhraseAssertions = () => { window.phraseSeen = new Set(); window.phraseWrong = []; };
  window.preparePhraseQuestion = () => {
    const s = phraseSession;
    const entry = data[s.collection].find(item => item.english === s.entry.english);
    check(Boolean(entry), 'Question from another collection');
    check(!phraseSeen.has(entry.english), 'Repeated English entry');
    phraseSeen.add(entry.english);
    check(el('word').textContent === (s.mode === 'en-ru' ? entry.english : entry.translation), 'Wrong prompt');
    check(Number(el('question-number').textContent) === s.index + 1, 'Wrong question number');
    check(el('word').lang === (s.mode === 'en-ru' ? 'en' : 'ru'), 'Wrong prompt language');
    check(s.options.length === 4 && el('options').children.length === 4, 'Not four options');
    check(s.options.filter(option => option.correct).length === 1, 'Not exactly one correct option');
    check(new Set(s.options.map(option => normalized(option.text))).size === 4, 'Duplicate options');
    s.options.forEach((option, i) => {
      const source = data[s.collection].find(item => item.english === option.english);
      check(source && source.translation === option.translation, 'Distractor from another collection');
      check(el('options').children[i].querySelector('.option-text').textContent === option.text, 'Wrong option label');
      check(el('options').children[i].querySelector('.option-text').lang === (s.mode === 'en-ru' ? 'ru' : 'en'), 'Wrong option language');
    });
    check(el('next').disabled, 'Can advance before answering');
    check(el('feedback-selected').hidden && el('feedback-selected').textContent === '', 'Old wrong translation remains');
    const indexBefore = s.index;
    el('next').click();
    check(s.index === indexBefore, 'Advanced without answering');
    return {correct: s.options.findIndex(option => option.correct), wrong: s.options.findIndex(option => !option.correct)};
  };
  window.verifyPhraseAnswer = ({correct, index}) => {
    const s = phraseSession;
    const choice = s.options[index];
    const entry = s.entry;
    check(choice.correct === correct, 'Test selected wrong expected correctness');
    check([...el('options').children].every(button => button.disabled), 'Options not locked');
    check(el('options').querySelectorAll('.correct').length === 1, 'Correct answer not highlighted');
    check(el('options').children[index].classList.contains(correct ? 'correct' : 'wrong'), 'Wrong answer color');
    const pair = s.mode === 'en-ru' ? `${entry.english} — ${entry.translation}` : `${entry.translation} — ${entry.english}`;
    check(el('feedback-detail').textContent === (correct ? pair : `Правильный ответ: ${pair}`), 'Wrong correct-answer translation');
    if (correct) check(el('feedback-selected').hidden, 'Wrong-choice message for a correct answer');
    else {
      const selectedPair = s.mode === 'en-ru' ? `${choice.translation} — ${choice.english}` : `${choice.english} — ${choice.translation}`;
      check(!el('feedback-selected').hidden && el('feedback-selected').textContent === `Вы выбрали: ${selectedPair}`, 'Wrong selected translation');
      phraseWrong.push({english: entry.english, translation: entry.translation});
    }
    check(s.answered === s.index + 1, 'Question advanced automatically');
    check(Number(el('mistake-count').textContent) === phraseWrong.length, 'Wrong mistake count');
    check(Number(el('correct-count').textContent) === s.answered - phraseWrong.length, 'Wrong correct count');
    const before = s.answered;
    [...el('options').children].forEach(button => button.click());
    check(s.answered === before, 'Locked answer counted again');
    check(!el('next').disabled, 'Next not enabled after answer');
  };
  window.finishPhraseBatch = limit => {
    for (let count = 0; count < limit && !phraseSession.finished; count += 1) {
      const indexes = preparePhraseQuestion();
      const correct = phraseSession.index % 3 !== 0;
      const index = correct ? indexes.correct : indexes.wrong;
      el('options').children[index].click();
      verifyPhraseAnswer({correct, index});
      el('next').click();
    }
  };
  window.verifyPhraseResults = () => {
    const s = phraseSession;
    check(!el('complete').hidden && el('training').hidden, 'Results not displayed');
    check(phraseSeen.size === s.total, 'Wrong number of unique English entries');
    check(Number(el('result-total').textContent) === s.total, 'Wrong result total');
    check(Number(el('result-mistakes').textContent) === phraseWrong.length, 'Wrong result errors');
    check(Number(el('result-correct').textContent) === s.total - phraseWrong.length, 'Wrong result score');
    const accuracy = Math.round((s.total - phraseWrong.length) / s.total * 100);
    check(el('result-percent').textContent === `${accuracy}%`, 'Wrong result percentage');
    check(Number(el('result-ring').style.getPropertyValue('--result-hue')) === accuracy * 1.2, 'Wrong score-ring color');
    check(el('mistake-review').hidden === (s.format !== 'express'), 'Wrong review visibility');
    if (s.format === 'express') {
      const rows = [...el('mistake-review-list').children];
      check(rows.length === phraseWrong.length, 'Wrong number of review rows');
      rows.forEach((row, i) => {
        const entry = phraseWrong[i];
        check(row.children[0].textContent === (s.mode === 'en-ru' ? entry.english : entry.translation), 'Wrong review prompt');
        check(row.children[1].textContent === (s.mode === 'en-ru' ? entry.translation : entry.english), 'Wrong review translation');
      });
    }
    return {total: s.total, order: s.order.map(entry => entry.english)};
  };
}"""

with sync_playwright() as playwright:
    executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
    browser = playwright.chromium.launch(headless=True, **({"executable_path": executable} if executable else {}))
    errors, remote_requests = [], []
    configurations = questions = native = 0
    for legacy in [False, True]:
        context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, offline=True)
        if legacy:
            context.add_init_script("Object.hasOwn = undefined; String.prototype.replaceAll = undefined; Element.prototype.replaceChildren = undefined; Element.prototype.replaceWith = undefined;")

        def serve(route):
            name = urlparse(route.request.url).path.rsplit("/", 1)[-1]
            if route.request.url.startswith(BASE) and name in ["index.html", "phrases.html"]:
                route.fulfill(status=200, content_type="text/html; charset=utf-8", body=(ROOT / name).read_text())
            elif route.request.url == BASE + "favicon.ico":
                route.fulfill(status=204, body="")
            else:
                remote_requests.append(route.request.url)
                route.abort()

        context.route("**/*", serve)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE + "index.html")
        assert page.locator("#phrases-link").get_attribute("href") == "./phrases.html"
        page.locator("#phrases-link").tap()
        page.wait_for_url(BASE + "phrases.html")
        assert page.locator("#intro").is_visible()
        assert page.locator("input[type=text], textarea, input[name=answer-mode]").count() == 0
        assert page.locator("#startup-warning").is_hidden()
        page.evaluate(HOOKS)
        for width in [320, 390, 1280]:
            page.set_viewport_size({"width": width, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), ("intro", width)
        page.set_viewport_size({"width": 390, "height": 844})
        if not legacy:
            page.screenshot(path=str(ARTIFACTS / "welcome-mobile.png"), full_page=True)

        for collection in ["expressions", "phrasal-verbs"]:
            for mode in ["en-ru", "ru-en"]:
                for test_format in ["express", "full"]:
                    for name, value in [("collection", collection), ("mode", mode), ("format", test_format)]:
                        page.locator(f'label:has(input[name="{name}"][value="{value}"])').tap()
                    page.locator("#start").tap()
                    total = 20 if test_format == "express" else 500
                    assert page.locator("#total-count").inner_text() == str(total)
                    assert page.locator("#progress").get_attribute("max") == str(total)
                    page.evaluate("beginPhraseAssertions()")
                    indices = page.evaluate("preparePhraseQuestion()")
                    page.locator(".option").nth(indices["wrong"]).tap()
                    page.evaluate("verifyPhraseAnswer", {"correct": False, "index": indices["wrong"]})
                    if not legacy and test_format == "express":
                        page.screenshot(path=str(ARTIFACTS / f"{collection}-{mode}-feedback-mobile.png"), full_page=True)
                    page.locator("#next").press("Enter")
                    indices = page.evaluate("preparePhraseQuestion()")
                    page.keyboard.press(str(indices["correct"] + 1))
                    page.evaluate("verifyPhraseAnswer", {"correct": True, "index": indices["correct"]})
                    page.locator("#next").tap()
                    native += 2
                    for width in [320, 390, 1280]:
                        page.set_viewport_size({"width": width, "height": 844})
                        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (collection, mode, width)
                    if not legacy and test_format == "express":
                        page.screenshot(path=str(ARTIFACTS / f"{collection}-{mode}.png"), full_page=True)
                    page.set_viewport_size({"width": 390, "height": 844})
                    for _ in range(0, total, 100):
                        page.evaluate("finishPhraseBatch(100)")
                    result = page.evaluate("verifyPhraseResults()")
                    assert result["total"] == total
                    questions += total
                    page.locator("#restart-complete").tap()
                    assert page.locator("#question-number").inner_text() == "1"
                    assert page.locator("#correct-count").inner_text() == "0"
                    assert page.locator("#mistake-count").inner_text() == "0"
                    assert page.evaluate("phraseSession.collection") == collection
                    assert page.evaluate("phraseSession.mode") == mode
                    assert page.evaluate("phraseSession.format") == test_format
                    order = page.evaluate("phraseSession.order.map(entry=>entry.english)")
                    assert order != result["order"]
                    assert len(order) == total and len(set(order)) == total
                    if test_format == "full":
                        assert set(order) == set(result["order"])
                    page.locator("#change-mode").tap()
                    configurations += 1
        page.locator(".words-link").tap()
        page.wait_for_url(BASE + "index.html")
        assert page.locator("#start").is_enabled()
        context.close()
        print(f"phrase quizzes: {'legacy APIs disabled' if legacy else 'standard'}; eight complete combinations passed", flush=True)

    browser.close()
    assert not errors, errors
    assert not remote_requests, remote_requests
    print(json.dumps({"status": "passed", "engine": "Chromium", "configurations": configurations,
                      "completedQuestions": questions, "nativeAnswers": native,
                      "widths": [320, 390, 1280], "errors": errors, "remoteRequests": remote_requests}))
