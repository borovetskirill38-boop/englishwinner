/* DOM rendering. All data and logic are embedded into index.html at build time. */
(() => {
  "use strict";
  const { words, distractors } = JSON.parse(document.getElementById("vocabulary-data").textContent);
  const $ = (id) => document.getElementById(id);
  const screens = ["intro", "training", "complete"];
  let session = null;

  function icon(name, className = "icon") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#icon-${name}`);
    svg.append(use);
    return svg;
  }

  function show(screen) {
    for (const id of screens) $(id).hidden = id !== screen;
    $("restart").hidden = screen === "intro";
    document.body.classList.toggle("is-training", screen !== "intro");
    if (screen === "intro") $("typed-outcome").hidden = true;
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
    const mode = Quiz.MODES[session.mode];
    const typing = session.answerMode === "typing";
    $("question-number").textContent = session.index + 1;
    $("total-count").textContent = session.total;
    $("word").textContent = session.prompt;
    $("word").lang = mode.questionLang;
    $("word").classList.toggle("russian-word", session.mode === "ru-en");
    $("word-note").textContent = typing
      ? (session.mode === "en-ru" ? "Введите перевод на русский — достаточно одного значения" : "Введите английский перевод")
      : mode.instruction;
    $("question-badge").textContent = typing ? "Ручной ввод" : "4 варианта · 1 верный";
    $("options").hidden = typing;
    $("typed-form").hidden = !typing;
    $("next").hidden = typing;
    $("choice-keyboard").hidden = typing;
    $("typing-keyboard").hidden = !typing;
    $("typed-answer").value = "";
    $("typed-answer").lang = mode.answerLang;
    $("typed-answer").placeholder = session.mode === "en-ru" ? "Напишите перевод" : "Type the English word";
    $("typed-answer").classList.remove("is-wrong");
    $("typed-answer").removeAttribute("aria-invalid");
    $("feedback").className = "feedback";
    $("feedback-title").textContent = "";
    $("feedback-detail").textContent = "";
    $("feedback-icon").replaceChildren();
    $("answer-hint").textContent = typing ? "Можно исправляться. Ошибка засчитывается при пропуске слова." : "Не спешите. Здесь нет таймера.";
    $("next").disabled = true;
    $("next").replaceChildren(document.createTextNode(
      session.index === session.total - 1 ? "Посмотреть результат" : "Следующее слово"
    ), icon("arrow"));
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
      text.lang = mode.answerLang;
      button.append(number, text, icon("check", "icon option-result"));
      button.addEventListener("click", () => answer(index));
      return button;
    });
    $("options").replaceChildren(...options);
    stats();
    $(typing ? "typed-answer" : "word").focus({ preventScroll: true });
  }

  function start() {
    const selectedMode = document.querySelector('input[name="mode"]:checked').value;
    const selectedFormat = document.querySelector('input[name="format"]:checked').value;
    const selectedAnswerMode = document.querySelector('input[name="answer-mode"]:checked').value;
    session = new Quiz.Session(words, distractors, Math.random, selectedMode, selectedFormat, selectedAnswerMode);
    $("typed-outcome").hidden = true;
    const mode = Quiz.MODES[session.mode];
    $("training-format").textContent = Quiz.FORMATS[session.format].name.toLocaleUpperCase("ru");
    $("direction-from").textContent = mode.from;
    $("direction-to").textContent = mode.to;
    $("change-mode").setAttribute("aria-label", `Сменить режим. Текущий: ${Quiz.FORMATS[session.format].name}, ${mode.name}, ${Quiz.ANSWER_MODES[session.answerMode].name}`);
    show("training");
    renderQuestion();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function answer(index) {
    if (!session || $("training").hidden) return;
    const result = session.answer(index);
    if (!result) return;
    const buttons = [...$("options").children];
    buttons.forEach((button, optionIndex) => {
      button.disabled = true;
      if (session.options[optionIndex].correct) {
        button.classList.add("correct");
        button.setAttribute("aria-label", `${session.options[optionIndex].text} — правильный ответ`);
      } else if (optionIndex === index) {
        button.classList.add("wrong");
        button.lastElementChild.replaceWith(icon("cross", "icon option-result"));
        button.setAttribute("aria-label", `${session.options[optionIndex].text} — неправильный ответ`);
      }
    });
    $("feedback").classList.add(result.correct ? "is-correct" : "is-wrong");
    $("feedback-title").textContent = result.correct ? "Верно! Так держать." : "Неправильно. Запомним на следующий раз.";
    $("feedback-detail").textContent = session.mode === "ru-en"
      ? `${result.translation} — ${session.entry.word}`
      : `${session.entry.word} — ${result.translation}`;
    $("feedback-icon").replaceChildren(icon(result.correct ? "check" : "cross"));
    $("answer-hint").textContent = "Перевод останется на экране, пока вы не продолжите.";
    $("next").disabled = false;
    stats();
    $("next").focus({ preventScroll: true });
  }

  function advanceTyped(result) {
    const pair = result.skipped
      ? `${result.word} — ${result.translation}`
      : (session.mode === "ru-en" ? `${session.prompt} — ${result.answer}` : `${result.word} — ${result.answer}`);
    stats();
    if (!session.advance()) return;
    if (session.finished) complete();
    else renderQuestion();
    $("typed-outcome").textContent = result.skipped ? `Пропущено: ${pair}. Засчитано как ошибка.` : `Верно: ${pair}`;
    $("typed-outcome").className = `typed-outcome${result.skipped ? " is-wrong" : ""}`;
    $("typed-outcome").hidden = false;
  }

  function submitTyped(event) {
    event.preventDefault();
    if (!session || session.answerMode !== "typing" || $("training").hidden) return;
    $("typed-outcome").hidden = true;
    const result = session.answerTyped($("typed-answer").value);
    if (!result) return;
    if (result.correct) {
      advanceTyped(result);
      return;
    }
    $("typed-answer").classList.add("is-wrong");
    $("typed-answer").setAttribute("aria-invalid", "true");
    $("feedback").className = "feedback is-wrong";
    $("feedback-title").textContent = result.empty ? "Введите перевод." : "Пока неверно. Попробуйте ещё раз.";
    $("feedback-detail").textContent = "Можно исправить ответ или пропустить слово — тогда будет засчитана ошибка.";
    $("feedback-icon").replaceChildren(icon("cross"));
    $("typed-answer").focus({ preventScroll: true });
  }

  function complete() {
    show("complete");
    const express = session.format === "express";
    $("complete-count").textContent = express ? "ЭКСПРЕСС-ТЕСТ ЗАВЕРШЁН" : `ВСЕ ${session.total} СЛОВ ПРОЙДЕНЫ`;
    $("result-total").textContent = session.total;
    $("result-mode").textContent = Quiz.MODES[session.mode].name;
    $("result-answer-mode").hidden = session.answerMode !== "typing";
    $("result-percent").textContent = `${session.accuracy}%`;
    $("result-ring").style.setProperty("--result-angle", `${session.correct / session.total * 360}deg`);
    $("result-correct").textContent = session.correct;
    $("result-mistakes").textContent = session.mistakes;
    if (express) {
      $("result-message").textContent = session.correct === session.total
        ? `Ни одной ошибки! Попробуйте новую подборку из ${session.total} слов.`
        : `${session.total} слов позади. Продолжайте практику с новой случайной подборкой.`;
    } else {
      $("result-message").textContent = session.correct === session.total
        ? "Ни одной ошибки! Попробуйте ещё раз в новом порядке."
        : "Вы справились с большим проходом. Повторите тест: знакомых слов будет всё больше.";
    }
    $("restart-complete").replaceChildren(
      document.createTextNode(express ? `Ещё ${session.total} слов` : "Пройти ещё раз"), icon("repeat")
    );
    $("completion-note").textContent = express
      ? `Каждый новый экспресс-тест — ${session.total} случайных слов из ${words.length}.`
      : "Новый проход — новый порядок слов и ответов.";
    $("complete-title").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function next() {
    if (!session || $("training").hidden || !session.advance()) return;
    if (session.finished) complete();
    else renderQuestion();
  }

  function chooseMode() {
    show("intro");
    document.querySelector('input[name="mode"]:checked').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function updateAnswerHints() {
    const typing = $("answer-mode-typing").checked;
    $("rule-answer").textContent = typing ? "Введите перевод и нажмите Enter." : "Выберите единственный верный вариант.";
    $("rule-feedback").textContent = typing ? "Верный ответ — дальше, пропуск — ошибка." : "Сразу узнайте результат и правильный перевод.";
  }

  $("start").addEventListener("click", start);
  $("next").addEventListener("click", next);
  $("restart").addEventListener("click", start);
  $("restart-complete").addEventListener("click", start);
  $("change-mode").addEventListener("click", chooseMode);
  $("change-mode-complete").addEventListener("click", chooseMode);
  $("typed-form").addEventListener("submit", submitTyped);
  $("skip-word").addEventListener("click", (event) => {
    if (event.detail > 1 || !session || session.answerMode !== "typing" || $("training").hidden) return;
    const result = session.skip();
    if (result) advanceTyped(result);
  });
  $("typed-answer").addEventListener("input", () => {
    $("typed-answer").classList.remove("is-wrong");
    $("typed-answer").removeAttribute("aria-invalid");
    $("feedback").className = "feedback";
  });
  document.querySelectorAll('input[name="answer-mode"]').forEach((input) => input.addEventListener("change", updateAnswerHints));
  updateAnswerHints();
  document.querySelector(".brand").addEventListener("click", (event) => {
    event.preventDefault();
    chooseMode();
  });
  document.addEventListener("keydown", (event) => {
    if (event.repeat || !session || session.answerMode !== "choice" || $("training").hidden || event.altKey || event.ctrlKey || event.metaKey) return;
    const active = document.activeElement;
    if (active?.matches("input, textarea, select, [contenteditable]")) return;
    if (/^[1-4]$/.test(event.key)) {
      event.preventDefault();
      answer(Number(event.key) - 1);
    } else if (event.key === "Enter" && active === $("next")) {
      event.preventDefault();
      next();
    }
  });
})();
