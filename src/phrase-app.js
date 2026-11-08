/* Separate multiple-choice page for expressions and multiword verbs. */
(() => {
  "use strict";
  const data = JSON.parse(document.getElementById("phrase-data").textContent);
  const $ = (id) => document.getElementById(id);
  let session = null;

  function replaceChildren(element, ...children) {
    while (element.firstChild) element.removeChild(element.firstChild);
    children.forEach((child) => element.appendChild(child));
  }
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#icon-${name}`);
    svg.appendChild(use);
    return svg;
  }
  function show(screen) {
    ["intro", "training", "complete"].forEach((id) => { $(id).hidden = id !== screen; });
    $("restart").hidden = screen === "intro";
    document.body.classList.toggle("is-training", screen !== "intro");
  }
  function stats() {
    $("correct-count").textContent = session.correct;
    $("mistake-count").textContent = session.mistakes;
    $("accuracy").textContent = `${session.accuracy}%`;
    $("progress").value = session.answered;
    $("progress").max = session.total;
    $("progress").setAttribute("aria-valuetext", `${session.answered} из ${session.total} вопросов`);
  }
  function renderQuestion() {
    $("question-number").textContent = session.index + 1;
    $("total-count").textContent = session.total;
    $("word").textContent = session.prompt;
    $("word").lang = session.mode === "en-ru" ? "en" : "ru";
    $("word-note").textContent = session.mode === "en-ru" ? "Выберите перевод на русский" : "Выберите выражение на английском";
    $("feedback").className = "feedback";
    $("feedback-title").textContent = "";
    $("feedback-selected").textContent = "";
    $("feedback-selected").hidden = true;
    $("feedback-detail").textContent = "";
    replaceChildren($("feedback-icon"));
    $("next").disabled = true;
    replaceChildren($("next"), document.createTextNode(session.index === session.total - 1 ? "Посмотреть результат" : "Следующий вопрос"), icon("arrow"));
    const options = session.options.map((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option";
      const number = document.createElement("span");
      number.className = "option-number";
      number.textContent = index + 1;
      number.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.className = "option-text";
      text.textContent = option.text;
      text.lang = session.mode === "en-ru" ? "ru" : "en";
      replaceChildren(button, number, text);
      button.addEventListener("click", () => answer(index));
      return button;
    });
    replaceChildren($("options"), ...options);
    stats();
    $("word").focus({ preventScroll: true });
  }
  function start() {
    const selected = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
    session = new PhraseQuiz.Session(data, selected("collection"), selected("mode"), selected("format"));
    $("training-format").textContent = session.format === "express" ? "ЭКСПРЕСС-ТЕСТ" : "ПОЛНЫЙ ТЕСТ";
    $("training-collection").textContent = PhraseQuiz.COLLECTIONS[session.collection];
    $("direction").textContent = session.mode === "en-ru" ? "EN → RU" : "RU → EN";
    show("training");
    renderQuestion();
    window.scrollTo(0, 0);
  }
  function answer(index) {
    if (!session || $("training").hidden) return;
    const result = session.answer(index);
    if (!result) return;
    [...$("options").children].forEach((button, i) => {
      const option = session.options[i];
      button.disabled = true;
      if (option.correct || i === index) {
        button.classList.add(option.correct ? "correct" : "wrong");
        button.setAttribute("aria-label", `${option.text} — ${option.correct ? "правильный" : "неправильный"} ответ`);
      }
    });
    $("feedback").classList.add(result.correct ? "is-correct" : "is-wrong");
    $("feedback-title").textContent = result.correct ? "Верно! Так держать." : "Неправильно. Запомним перевод.";
    if (!result.correct) {
      const choice = result.selected;
      $("feedback-selected").textContent = `Вы выбрали: ${session.mode === "en-ru" ? `${choice.translation} — ${choice.english}` : `${choice.english} — ${choice.translation}`}`;
      $("feedback-selected").hidden = false;
    }
    const pair = session.mode === "en-ru" ? `${result.english} — ${result.translation}` : `${result.translation} — ${result.english}`;
    $("feedback-detail").textContent = result.correct ? pair : `Правильный ответ: ${pair}`;
    replaceChildren($("feedback-icon"), icon(result.correct ? "check" : "cross"));
    $("next").disabled = false;
    stats();
    $("next").focus({ preventScroll: true });
  }
  function complete() {
    show("complete");
    $("complete-count").textContent = session.format === "express" ? "ЭКСПРЕСС-ТЕСТ ЗАВЕРШЁН" : "ВСЕ 500 ВОПРОСОВ ПРОЙДЕНЫ";
    $("result-mode").textContent = `${PhraseQuiz.COLLECTIONS[session.collection]} · ${session.mode === "en-ru" ? "EN → RU" : "RU → EN"}`;
    $("result-percent").textContent = `${session.accuracy}%`;
    $("result-ring").style.setProperty("--result-angle", `${session.correct / session.total * 360}deg`);
    $("result-ring").style.setProperty("--result-hue", String(session.accuracy * 1.2));
    $("result-correct").textContent = session.correct;
    $("result-mistakes").textContent = session.mistakes;
    $("result-total").textContent = session.total;
    $("result-message").textContent = session.correct === session.total ? "Ни одной ошибки! Попробуйте новый проход." : "Ещё один шаг вперёд. Продолжайте практику в своём темпе.";
    $("mistake-review").hidden = session.format !== "express";
    $("mistake-review-table").hidden = session.mistakes === 0;
    $("mistake-review-title").textContent = session.collection === "expressions" ? "Выражения для повторения" : "Фразовые глаголы для повторения";
    $("mistake-review-message").textContent = session.mistakes ? "Повторите правильные переводы:" : "Все ответы верные — ошибок нет.";
    $("review-source").textContent = session.mode === "en-ru" ? "Английский" : "Русский";
    const rows = session.incorrectEntries.map((entry) => {
      const row = document.createElement("tr");
      const prompt = document.createElement("td");
      const translation = document.createElement("td");
      prompt.textContent = session.mode === "en-ru" ? entry.english : entry.translation;
      prompt.lang = session.mode === "en-ru" ? "en" : "ru";
      translation.textContent = session.mode === "en-ru" ? entry.translation : entry.english;
      translation.lang = session.mode === "en-ru" ? "ru" : "en";
      replaceChildren(row, prompt, translation);
      return row;
    });
    replaceChildren($("mistake-review-list"), ...rows);
    $("complete-title").focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  function next() {
    if (!session || $("training").hidden || !session.advance()) return;
    if (session.finished) complete();
    else renderQuestion();
  }
  function chooseMode() {
    show("intro");
    document.querySelector('input[name="collection"]:checked').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  $("start").addEventListener("click", start);
  $("next").addEventListener("click", next);
  $("change-mode").addEventListener("click", chooseMode);
  $("change-mode-complete").addEventListener("click", chooseMode);
  $("restart-complete").addEventListener("click", start);
  $("restart").addEventListener("click", start);
  document.querySelector(".brand").addEventListener("click", (event) => {
    event.preventDefault();
    chooseMode();
  });
  document.addEventListener("keydown", (event) => {
    if (event.repeat || !session || $("training").hidden || event.altKey || event.ctrlKey || event.metaKey) return;
    const active = document.activeElement;
    if (active && active.matches("input, textarea, select, [contenteditable]")) return;
    if (/^[1-4]$/.test(event.key)) { event.preventDefault(); answer(Number(event.key) - 1); }
    if (event.key === "Enter" && session.selected !== null) { event.preventDefault(); next(); }
  });
  $("start").disabled = false;
  $("startup-warning").hidden = true;
})();
