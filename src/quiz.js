/* English Winner — quiz logic; no browser dependencies. */
const Quiz = (() => {
  "use strict";

  function shuffle(items, random = Math.random) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function normalize(text) {
    return text.toLocaleLowerCase("ru").replaceAll("ё", "е").trim();
  }

  function primaryTranslation(entry) {
    return entry.translation.split(";")[0].trim();
  }

  function normalizeAnswer(text) {
    if (typeof text !== "string") return "";
    return text.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё", "е")
      .replace(/[’‘]/g, "'").replace(/[‐‑‒–—−]/g, "-")
      .replace(/[.,!?…:;«»"“”]/g, " ").replace(/\s+/g, " ").trim()
      .replace(/^'+|'+$/g, "").trim();
  }

  function translationVariants(entry) {
    return [...entry.translation.split(";"), ...(entry.aliases || [])]
      .map((text) => text.replace(/\([^)]*\)/g, " ").trim()).filter(Boolean);
  }

  function buildEnglishIndex(words) {
    const index = new Map();
    for (const entry of words) {
      // Keep sense qualifiers: 'часы (единицы времени)' must not match 'clock'.
      for (const text of [...entry.translation.split(";"), ...(entry.aliases || [])]) {
        const key = normalizeAnswer(text);
        if (!key) continue;
        if (!index.has(key)) index.set(key, new Set());
        index.get(key).add(normalizeAnswer(entry.word));
      }
    }
    return index;
  }

  function matchesAnswer(entry, mode, text, englishIndex) {
    checkMode(mode);
    if (mode === "en-ru") {
      const answer = normalizeAnswer(typeof text === "string" ? text.replace(/\([^)]*\)/g, " ") : "");
      return Boolean(answer) && translationVariants(entry).some((value) => normalizeAnswer(value) === answer);
    }
    let answer = normalizeAnswer(text);
    if (!answer) return false;
    // The infinitive marker is optional when the Russian prompt is a verb.
    if (category(entry) === "verb" && answer.startsWith("to ")) answer = answer.slice(3);
    const accepted = englishIndex?.get(normalizeAnswer(primaryTranslation(entry)));
    return answer === normalizeAnswer(entry.word) || Boolean(accepted?.has(answer));
  }

  const MODES = Object.freeze({
    "en-ru": Object.freeze({
      name: "Английский → русский", from: "EN", to: "RU",
      questionLang: "en", answerLang: "ru", instruction: "Выберите перевод на русский",
    }),
    "ru-en": Object.freeze({
      name: "Русский → английский", from: "RU", to: "EN",
      questionLang: "ru", answerLang: "en", instruction: "Выберите английское слово",
    }),
  });

  const FORMATS = Object.freeze({
    full: Object.freeze({ name: "Полный тест", limit: null }),
    express: Object.freeze({ name: "Экспресс-тест", limit: 20 }),
  });

  const ANSWER_MODES = Object.freeze({
    choice: Object.freeze({ name: "4 варианта" }),
    typing: Object.freeze({ name: "Ручной ввод" }),
  });

  function checkMode(mode) {
    if (!Object.hasOwn(MODES, mode)) throw new Error(`Неизвестный режим: ${mode}`);
  }

  function questionFor(entry, mode = "en-ru") {
    checkMode(mode);
    return mode === "ru-en" ? primaryTranslation(entry) : entry.word;
  }

  function correctFor(entry, mode = "en-ru") {
    checkMode(mode);
    return mode === "ru-en" ? entry.word : primaryTranslation(entry);
  }

  const numbers = new Set([
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "hundred", "thousand", "million", "millions", "thousands",
    "zero", "twenty", "hundreds", "dozen", "billion",
  ]);

  function category(entry) {
    const first = primaryTranslation(entry);
    if (numbers.has(entry.word)) return "number";
    if (/(ть|ться|ти|чь)$/.test(first)) return "verb";
    if (/(ый|ий|ой|ая|ое|ые|ущий|ющий|ящий|щийся|вшийся)$/.test(first)) return "adjective";
    if (/^(\S+(о|но|ко)|в\s.+|на\s.+|по\S+)$/.test(first)) return "adverb";
    return "noun";
  }

  function optionsFor(entry, bank, random = Math.random, mode = "en-ru") {
    const correctText = correctFor(entry, mode);
    const aliases = [...normalize(entry.translation).split(/[;(),]/), ...(entry.aliases || []).map(normalize)].map((s) => s.trim());
    const candidates = bank[category(entry)].filter((candidate) => {
      if ((candidate.exclude || []).includes(entry.word)) return false;
      if (normalize(candidate.english) === normalize(entry.word)) return false;
      return !aliases.includes(normalize(candidate.text));
    });
    const labels = candidates.map((c) => mode === "ru-en" ? c.english : c.text);
    const unique = [...new Map(labels.map((text) => [normalize(text), text])).values()];
    if (unique.length < 3) throw new Error(`Недостаточно вариантов для ${entry.word}`);
    const distractors = shuffle(unique, random).slice(0, 3).map((text) => ({
      text,
      correct: false,
    }));
    return shuffle([{ text: correctText, correct: true }, ...distractors], random);
  }

  class Session {
    constructor(words, bank, random = Math.random, mode = "en-ru", format = "full", answerMode = "choice") {
      if (!words.length) throw new Error("Список слов пуст");
      checkMode(mode);
      if (!Object.hasOwn(FORMATS, format)) throw new Error(`Неизвестный формат: ${format}`);
      if (!Object.hasOwn(ANSWER_MODES, answerMode)) throw new Error(`Неизвестный способ ответа: ${answerMode}`);
      const limit = FORMATS[format].limit ?? words.length;
      if (words.length < limit) throw new Error(`Для этого формата нужно не менее ${limit} слов`);
      this.order = shuffle(words, random).slice(0, limit);
      this.bank = bank;
      this.random = random;
      this.mode = mode;
      this.format = format;
      this.answerMode = answerMode;
      this.englishIndex = answerMode === "typing" && mode === "ru-en" ? buildEnglishIndex(words) : null;
      this.index = 0;
      this.correct = 0;
      this.answered = 0;
      this.selected = null;
      this.options = answerMode === "choice" ? optionsFor(this.entry, bank, random, mode) : [];
    }

    get entry() { return this.order[this.index]; }
    get prompt() { return this.finished ? "" : questionFor(this.entry, this.mode); }
    get total() { return this.order.length; }
    get finished() { return this.index >= this.total; }
    get mistakes() { return this.answered - this.correct; }
    get accuracy() { return this.answered ? Math.round(this.correct / this.answered * 100) : 0; }

    answer(optionIndex) {
      if (this.answerMode !== "choice" || this.finished || this.selected !== null || !Number.isInteger(optionIndex)
          || optionIndex < 0 || optionIndex >= this.options.length) return null;
      return this.#record(this.options[optionIndex].correct, optionIndex);
    }

    #record(correct, selected) {
      this.selected = selected;
      this.answered += 1;
      if (correct) this.correct += 1;
      return { correct, word: this.entry.word, translation: this.entry.translation };
    }

    answerTyped(text) {
      if (this.answerMode !== "typing" || this.finished || this.selected !== null) return null;
      if (!normalizeAnswer(text)) return { correct: false, empty: true };
      if (!matchesAnswer(this.entry, this.mode, text, this.englishIndex)) return { correct: false, retry: true };
      return { ...this.#record(true, "typed"), answer: text.trim() };
    }

    skip() {
      if (this.answerMode !== "typing" || this.finished || this.selected !== null) return null;
      return { ...this.#record(false, "skipped"), skipped: true };
    }

    advance() {
      if (this.finished || this.selected === null) return false;
      this.index += 1;
      this.selected = null;
      this.options = this.finished || this.answerMode === "typing" ? [] : optionsFor(this.entry, this.bank, this.random, this.mode);
      return true;
    }
  }

  return { MODES, FORMATS, ANSWER_MODES, shuffle, normalize, normalizeAnswer, primaryTranslation,
    translationVariants, buildEnglishIndex, matchesAnswer, questionFor, correctFor, category, optionsFor, Session };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Quiz;
