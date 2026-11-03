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
    $("word").textContent = session.entry.word;
    $("feedback").className = "feedback";
    $("feedback-title").textContent = "";
    $("feedback-detail").textContent = "";
    $("feedback-icon").replaceChildren();
    $("answer-hint").textContent = "Не спешите. Здесь нет таймера.";
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
      button.append(number, text, icon("check", "icon option-result"));
      button.addEventListener("click", () => answer(index));
      return button;
    });
    $("options").replaceChildren(...options);
    stats();
    $("word").focus({ preventScroll: true });
  }

  function start() {
    session = new Quiz.Session(words, distractors);
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
    $("feedback-detail").textContent = `${session.entry.word} — ${result.translation}`;
    $("feedback-icon").replaceChildren(icon(result.correct ? "check" : "cross"));
    $("answer-hint").textContent = "Перевод останется на экране, пока вы не продолжите.";
    $("next").disabled = false;
    stats();
    $("next").focus({ preventScroll: true });
  }

  function complete() {
    show("complete");
    $("result-percent").textContent = `${session.accuracy}%`;
    $("result-ring").style.setProperty("--result-angle", `${session.correct / session.total * 360}deg`);
    $("result-correct").textContent = session.correct;
    $("result-mistakes").textContent = session.mistakes;
    $("result-message").textContent = session.correct === session.total
      ? "Ни одной ошибки! Попробуйте ещё раз в новом порядке."
      : "Вы справились с большим проходом. Повторите тест: знакомых слов будет всё больше.";
    $("complete-title").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function next() {
    if (!session || $("training").hidden || !session.advance()) return;
    if (session.finished) complete();
    else renderQuestion();
  }

  $("start").addEventListener("click", start);
  $("next").addEventListener("click", next);
  $("restart").addEventListener("click", start);
  $("restart-complete").addEventListener("click", start);
  document.querySelector(".brand").addEventListener("click", (event) => {
    event.preventDefault();
    show("intro");
    $("start").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  document.addEventListener("keydown", (event) => {
    if (event.repeat || !session || $("training").hidden || event.altKey || event.ctrlKey || event.metaKey) return;
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
