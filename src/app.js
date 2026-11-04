/* DOM rendering. All data and logic are embedded into index.html at build time. */
(() => {
  "use strict";
  const { words, distractors } = JSON.parse(document.getElementById("vocabulary-data").textContent);
  const $ = (id) => document.getElementById(id);
  const screens = ["intro", "training", "complete"];
  let session = null;

  // replaceChildren is absent in Safari before iOS 14.
  function replaceChildren(element, ...children) {
    while (element.firstChild) element.removeChild(element.firstChild);
    children.forEach((child) => element.appendChild(child));
  }

  function icon(name, className = "icon") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#icon-${name}`);
    svg.appendChild(use);
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
    if (session.topic !== "all") $("word-note").textContent += ` · По теме «${Quiz.TOPICS[session.topic]}»`;
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
    replaceChildren($("feedback-icon"));
    $("answer-hint").textContent = typing ? "Можно исправляться. Ошибка засчитывается при пропуске слова." : "Не спешите. Здесь нет таймера.";
    $("next").disabled = true;
    replaceChildren($("next"), document.createTextNode(
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
      replaceChildren(button, number, text, icon("check", "icon option-result"));
      button.addEventListener("click", () => answer(index));
      return button;
    });
    replaceChildren($("options"), ...options);
    stats();
    $(typing ? "typed-answer" : "word").focus({ preventScroll: true });
  }

  function start() {
    const selectedMode = document.querySelector('input[name="mode"]:checked').value;
    const selectedFormat = document.querySelector('input[name="format"]:checked').value;
    const selectedAnswerMode = document.querySelector('input[name="answer-mode"]:checked').value;
    const selectedLevel = document.querySelector('input[name="level"]:checked').value;
    const selectedTopic = $("topic").value;
    session = new Quiz.Session(words, distractors, Math.random, selectedMode, selectedFormat, selectedAnswerMode, selectedLevel, selectedTopic);
    $("typed-outcome").hidden = true;
    const mode = Quiz.MODES[session.mode];
    $("training-format").textContent = Quiz.FORMATS[session.format].name.toLocaleUpperCase("ru");
    $("training-level").textContent = `Уровень: ${session.levelSize} слов`;
    $("training-topic").textContent = Quiz.TOPICS[session.topic];
    $("direction-from").textContent = mode.from;
    $("direction-to").textContent = mode.to;
    $("change-mode").setAttribute("aria-label", `Сменить режим. Текущий: ${session.levelSize} слов, ${Quiz.TOPICS[session.topic]}, ${Quiz.FORMATS[session.format].name}, ${mode.name}, ${Quiz.ANSWER_MODES[session.answerMode].name}`);
    show("training");
    renderQuestion();
    window.scrollTo(0, 0);
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
        button.replaceChild(icon("cross", "icon option-result"), button.lastElementChild);
        button.setAttribute("aria-label", `${session.options[optionIndex].text} — неправильный ответ`);
      }
    });
    $("feedback").classList.add(result.correct ? "is-correct" : "is-wrong");
    $("feedback-title").textContent = result.correct ? "Верно! Так держать." : "Неправильно. Запомним на следующий раз.";
    $("feedback-detail").textContent = session.mode === "ru-en"
      ? `${result.translation} — ${session.entry.word}`
      : `${session.entry.word} — ${result.translation}`;
    replaceChildren($("feedback-icon"), icon(result.correct ? "check" : "cross"));
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
    replaceChildren($("feedback-icon"), icon("cross"));
    $("typed-answer").focus({ preventScroll: true });
  }

  function complete() {
    show("complete");
    const express = session.format === "express";
    $("complete-count").textContent = express ? "ЭКСПРЕСС-ТЕСТ ЗАВЕРШЁН"
      : (session.topic === "all" ? `ВСЕ ${session.total} СЛОВ ПРОЙДЕНЫ` : "ТЕМА ПРОЙДЕНА");
    $("result-total").textContent = session.total;
    $("result-mode").textContent = Quiz.MODES[session.mode].name;
    $("result-level").textContent = `Уровень: ${session.levelSize} самых частотных слов`;
    $("result-topic").textContent = `Тема: ${Quiz.TOPICS[session.topic]}`;
    $("result-answer-mode").hidden = session.answerMode !== "typing";
    $("result-percent").textContent = `${session.accuracy}%`;
    $("result-ring").style.setProperty("--result-angle", `${session.correct / session.total * 360}deg`);
    $("result-correct").textContent = session.correct;
    $("result-mistakes").textContent = session.mistakes;
    if (express) {
      $("result-message").textContent = session.correct === session.total
        ? `Ни одной ошибки! Попробуйте новую подборку из ${session.total} слов.`
        : `${Quiz.wordCount(session.total)} позади. Продолжайте практику с новой случайной подборкой.`;
    } else {
      $("result-message").textContent = session.correct === session.total
        ? "Ни одной ошибки! Попробуйте ещё раз в новом порядке."
        : "Вы справились с большим проходом. Повторите тест: знакомых слов будет всё больше.";
    }
    replaceChildren($("restart-complete"),
      document.createTextNode(express ? `Ещё ${Quiz.wordCount(session.total)}` : "Пройти ещё раз"), icon("repeat")
    );
    if (session.topic === "all") {
      $("completion-note").textContent = express
        ? `Каждый новый экспресс-тест — ${session.total} случайных слов из ${session.vocabularySize}.`
        : `Новый проход — те же ${session.vocabularySize} частотных слов в новом порядке.`;
    } else {
      $("completion-note").textContent = express && session.vocabularySize > session.total
        ? `Новая подборка — ${Quiz.wordCount(session.total)} из ${session.vocabularySize} в теме «${Quiz.TOPICS[session.topic]}».`
        : `Новый проход — те же ${Quiz.wordCount(session.vocabularySize)} темы «${Quiz.TOPICS[session.topic]}» в новом порядке.`;
    }
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
    document.querySelector('input[name="mode"]:checked').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function updateAnswerHints() {
    const typing = $("answer-mode-typing").checked;
    $("rule-answer").textContent = typing ? "Введите перевод и нажмите Enter." : "Выберите единственный верный вариант.";
    $("rule-feedback").textContent = typing ? "Верный ответ — дальше, пропуск — ошибка." : "Сразу узнайте результат и правильный перевод.";
  }

  function updateLevelHints() {
    const level = document.querySelector('input[name="level"]:checked').value;
    const size = Quiz.LEVELS[level].size;
    $("level-description").textContent = `Вопросы и варианты ответа — из ${size} самых частотных слов.`;
    const previous = $("topic").value || "all";
    const levelWords = Quiz.wordsForLevel(words, level);
    const options = Object.keys(Quiz.TOPICS).map((id) => {
      const option = document.createElement("option");
      const count = Quiz.wordsForTopic(levelWords, id).length;
      option.value = id;
      option.textContent = `${Quiz.TOPICS[id]} — ${Quiz.wordCount(count)}`;
      option.disabled = count === 0;
      return option;
    });
    replaceChildren($("topic"), ...options);
    $("topic").value = Object.keys(Quiz.TOPICS).includes(previous) ? previous : "all";
    updateTopicHints();
  }

  function updateTopicHints() {
    const level = document.querySelector('input[name="level"]:checked').value;
    const topic = $("topic").value;
    const count = Quiz.wordsForTopic(Quiz.wordsForLevel(words, level), topic).length;
    const expressCount = Math.min(20, count);
    $("full-format-note").textContent = topic === "all" ? `Все ${count} слов` : `Всего ${Quiz.wordCount(count)}`;
    $("format-full").setAttribute("aria-label", `Полный тест — ${Quiz.wordCount(count)}`);
    $("express-format-note").textContent = expressCount === 20 ? "20 случайных слов" : Quiz.wordCount(expressCount);
    $("format-express").setAttribute("aria-label", `Экспресс-тест — ${Quiz.wordCount(expressCount)}`);
    let description = topic === "all" ? "Все слова выбранного уровня."
      : `${Quiz.wordCount(count)} темы из первых ${level} частотных слов.`;
    if (count > 0 && count < 20) description += ` Экспресс-тест: ${Quiz.wordCount(count)}, без повторов.`;
    if (count === 0) description = "В этой теме нет слов выбранного уровня. Выберите другую тему или уровень.";
    const unavailable = count === 0 || (count < 4 && $("answer-mode-choice").checked);
    if (count > 0 && count < 4 && $("answer-mode-choice").checked) description += " Для четырёх вариантов нужно хотя бы четыре слова. Выберите ручной ввод.";
    $("topic-description").textContent = description;
    $("start").disabled = unavailable;
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
  document.querySelectorAll('input[name="answer-mode"]').forEach((input) => input.addEventListener("change", () => {
    updateAnswerHints(); updateTopicHints();
  }));
  updateAnswerHints();
  document.querySelectorAll('input[name="level"]').forEach((input) => input.addEventListener("change", updateLevelHints));
  updateLevelHints();
  $("topic").addEventListener("change", updateTopicHints);
  document.querySelector(".brand").addEventListener("click", (event) => {
    event.preventDefault();
    chooseMode();
  });
  document.addEventListener("keydown", (event) => {
    if (event.repeat || !session || session.answerMode !== "choice" || $("training").hidden || event.altKey || event.ctrlKey || event.metaKey) return;
    const active = document.activeElement;
    if (active && active.matches("input, textarea, select, [contenteditable]")) return;
    if (/^[1-4]$/.test(event.key)) {
      event.preventDefault();
      answer(Number(event.key) - 1);
    } else if (event.key === "Enter" && active === $("next")) {
      event.preventDefault();
      next();
    }
  });
  $("startup-warning").hidden = true;
  updateTopicHints();
})();
