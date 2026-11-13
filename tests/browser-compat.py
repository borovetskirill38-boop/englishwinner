"""Touch regression in Chromium with older Safari APIs removed; not a WebKit/device test."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
LANGUAGE = os.environ.get("QUIZ_LANGUAGE", "en")
assert LANGUAGE in ["en", "es"]
PAGE = "spanish.html" if LANGUAGE == "es" else "index.html"
ARTIFACTS = Path(os.environ.get("QUIZ_SCREENSHOTS", "/tmp/englishwinner-screenshots"))
ARTIFACTS.mkdir(parents=True, exist_ok=True)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_port}/{PAGE}"
results = []
try:
    with sync_playwright() as playwright:
        executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
        browser = playwright.chromium.launch(headless=True, **({"executable_path": executable} if executable else {}))
        for profile in ["modern-touch", "legacy-apis-removed"]:
            context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
            if profile == "legacy-apis-removed":
                context.add_init_script("""
                  Object.hasOwn = undefined;
                  String.prototype.replaceAll = undefined;
                  Element.prototype.replaceChildren = undefined;
                  Element.prototype.replaceWith = undefined;
                  const originalScrollTo = window.scrollTo;
                  window.scrollTo = function(...args) {
                    if (args[0] && args[0].behavior === 'instant') throw new Error('Unsupported scroll behavior');
                    return originalScrollTo.apply(window, args);
                  };
                """)
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(url, wait_until="load")
            context.set_offline(True)
            assert page.locator("#startup-warning").is_hidden()
            assert page.locator("#start").is_enabled()
            if profile == "legacy-apis-removed":
                assert page.evaluate("[Object.hasOwn, String.prototype.replaceAll, Element.prototype.replaceChildren, Element.prototype.replaceWith].every(value => value === undefined)")
            # Observe the real session to disambiguate identical Russian prompts.
            # Every state change uses taps and forms, with no test hooks in the app.
            page.evaluate("""() => {
              const Original = Quiz.Session;
              Quiz.Session = class extends Original {
                constructor(...args) { super(...args); window.__session = this; }
              };
            }""")
            configurations = 0
            for level in ["1000", "3000", "5000"]:
                for mode in [f"{LANGUAGE}-ru", f"ru-{LANGUAGE}"]:
                    for test_format in ["full", "express"]:
                        for answer_mode in ["choice", "typing"]:
                            for name, value in [("level", level), ("mode", mode), ("format", test_format), ("answer-mode", answer_mode)]:
                                page.locator(f'label:has(input[name="{name}"][value="{value}"])').tap()
                            page.locator("#start").tap()
                            assert page.locator("#training").is_visible()
                            assert page.locator("#total-count").inner_text() == ("20" if test_format == "express" else level)
                            assert page.locator("#question-number").inner_text() == "1"
                            for index in range(20 if test_format == "express" else 3):
                                if answer_mode == "choice":
                                    option = page.evaluate("""wrong => window.__session.options.findIndex(option => option.correct !== wrong)""", index == 1)
                                    page.locator(".option").nth(option).tap()
                                    assert page.locator(".option.wrong" if index == 1 else ".option.correct").count() == 1
                                    page.locator("#next").tap()
                                elif index == 1:
                                    page.locator("#typed-answer").fill("___wrong___")
                                    page.locator("#check-answer").tap()
                                    assert page.locator("#question-number").inner_text() == "2"
                                    assert page.locator("#typed-answer").get_attribute("aria-invalid") == "true"
                                    page.locator("#skip-word").tap()
                                    assert page.locator("#question-number").inner_text() == "3", (profile, level, mode, "skip ignored")
                                else:
                                    answer = page.evaluate("""() => window.__session.mode === Quiz.FORWARD
                                      ? Quiz.translationVariants(window.__session.entry)[0] : window.__session.entry.word""")
                                    page.locator("#typed-answer").fill(answer)
                                    page.locator("#check-answer").tap()
                                    assert "Верно" in page.locator("#typed-outcome").inner_text()
                            if test_format == "express":
                                assert page.locator("#complete").is_visible()
                                assert page.locator("#result-correct").inner_text() == "19"
                                assert page.locator("#result-mistakes").inner_text() == "1"
                                page.locator("#restart-complete").tap()
                                assert page.locator("#question-number").inner_text() == "1"
                                assert page.locator("#correct-count").inner_text() == "0"
                            else:
                                actual = page.locator("#question-number").inner_text()
                                if actual != "4":
                                    page.screenshot(path=str(ARTIFACTS / "unexpected-question.png"), full_page=True)
                                assert actual == "4", (profile, level, mode, answer_mode, actual,
                                    page.evaluate("({index:__session.index,answered:__session.answered,selected:__session.selected,attempts:__session.attemptsUsed,word:__session.entry.word,feedback:document.getElementById('feedback-detail').textContent})"))
                                assert page.locator("#correct-count").inner_text() == "2"
                                assert page.locator("#mistake-count").inner_text() == "1"
                            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                            page.locator("#change-mode").tap()
                            assert page.locator("#intro").is_visible()
                            configurations += 1
            assert not errors, errors
            page.screenshot(path=str(ARTIFACTS / f"compat-{profile}.png"), full_page=True)
            results.append({"profile": profile, "configurations": configurations, "errors": errors})
            context.close()

        context = browser.new_context(viewport={"width": 390, "height": 844}, java_script_enabled=False)
        page = context.new_page()
        page.goto(url, wait_until="load")
        assert page.locator("#startup-warning").is_visible()
        assert "предпросмотре" in page.locator("#startup-warning").inner_text()
        assert page.locator("#startup-warning a").get_attribute("href") == "https://borovetskirill38-boop.github.io/englishwinner/" + (PAGE if LANGUAGE == "es" else "")
        assert page.locator("#start").is_disabled()
        page.screenshot(path=str(ARTIFACTS / "compat-no-javascript.png"), full_page=True)
        context.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()

print(json.dumps({"engine": "Chromium", "touch": results, "noJavaScriptWarning": "passed"}))
