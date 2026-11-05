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
    return text.toLocaleLowerCase("ru").replace(/ё/g, "е").trim();
  }

  function primaryTranslation(entry) {
    return entry.translation.split(";")[0].trim();
  }

  function normalizeAnswer(text) {
    if (typeof text !== "string") return "";
    return text.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е")
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
    const accepted = englishIndex ? englishIndex.get(normalizeAnswer(primaryTranslation(entry))) : null;
    return answer === normalizeAnswer(entry.word) || Boolean(accepted && accepted.has(answer));
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

  const MAX_TYPING_ATTEMPTS = 3;

  const LEVELS = Object.freeze({
    "1000": Object.freeze({ name: "Базовый", size: 1000 }),
    "3000": Object.freeze({ name: "Средний", size: 3000 }),
    "5000": Object.freeze({ name: "Продвинутый", size: 5000 }),
  });

  const TOPICS = Object.freeze({
    all: "Все темы", home: "Дом и быт", family: "Семья и отношения", food: "Еда и напитки",
    work: "Работа и деньги", education: "Учёба и знания", travel: "Путешествия и транспорт",
    health: "Тело и здоровье", people: "Люди и характер", feelings: "Эмоции и переживания",
    communication: "Общение и речь", time: "Время и числа", nature: "Природа и животные",
    leisure: "Досуг, искусство и спорт", society: "Общество и религия", law: "Закон и безопасность",
    technology: "Техника и наука", actions: "Действия и движение", qualities: "Признаки и свойства",
    space: "Места и положение", basics: "Базовые слова и грамматика", life: "Жизнь и общие понятия",
  });

  function wordsForLevel(words, level) {
    if (!hasOwn(LEVELS, level)) throw new Error(`Неизвестный уровень: ${level}`);
    const size = LEVELS[level].size;
    if (words.length < size) throw new Error(`Для этого уровня нужно не менее ${size} слов`);
    // Source ranks precede randomization: a level always contains the same top N.
    return words.slice().sort((a, b) => a.rank - b.rank).slice(0, size);
  }

  function wordsForTopic(words, topic = "all") {
    if (!hasOwn(TOPICS, topic)) throw new Error(`Неизвестная тема: ${topic}`);
    if (topic === "all") return words.slice();
    return words.filter((entry) => (entry.topics || []).includes(topic)).map((entry) => {
      const meanings = entry.topicTranslations && entry.topicTranslations[topic];
      // Keep each word's rank and identity; choose only its meanings in this topic.
      return meanings ? Object.assign({}, entry, { translation: meanings.join("; "), aliases: [] }) : entry;
    });
  }

  function wordCount(count) {
    const tail = count % 100;
    const last = count % 10;
    const noun = tail >= 11 && tail <= 14 ? "слов" : (last === 1 ? "слово" : (last >= 2 && last <= 4 ? "слова" : "слов"));
    return `${count} ${noun}`;
  }

  function candidateFor(entry, excluded = []) {
    return { english: entry.word, text: primaryTranslation(entry), exclude: excluded,
      meanings: translationVariants(entry).map(normalizeAnswer) };
  }

  function bankForVocabulary(words, bank, includeAll = false) {
    const byWord = new Map(words.map((entry) => [entry.word, entry]));
    const scoped = {};
    if (includeAll) {
      const exclusions = new Map();
      for (const key of Object.keys(bank)) {
        scoped[key] = [];
        for (const candidate of bank[key]) exclusions.set(candidate.english, candidate.exclude || []);
      }
      scoped.fallback = words.map((entry) => candidateFor(entry, exclusions.get(entry.word) || []));
      for (const candidate of scoped.fallback) scoped[category(byWord.get(candidate.english))].push(candidate);
      return scoped;
    }
    for (const key of Object.keys(bank)) {
      scoped[key] = bank[key].filter((candidate) => byWord.has(candidate.english)).map((candidate) => {
        return candidateFor(byWord.get(candidate.english), candidate.exclude || []);
      });
    }
    return scoped;
  }

  function checkMode(mode) {
    if (!hasOwn(MODES, mode)) throw new Error(`Неизвестный режим: ${mode}`);
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
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
    "eleven", "twelve", "fifteen", "thirty", "forty", "fifty",
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
    const meanings = new Set(translationVariants(entry).map(normalizeAnswer));
    const eligible = (candidate) => {
      if ((candidate.exclude || []).includes(entry.word)) return false;
      if (normalize(candidate.english) === normalize(entry.word)) return false;
      if (candidate.meanings && candidate.meanings.some((meaning) => meanings.has(meaning))) return false;
      return !aliases.includes(normalize(candidate.text));
    };
    function uniqueOptions(candidates) {
      const labels = candidates.filter(eligible).map((candidate) => ({
        text: mode === "ru-en" ? candidate.english : candidate.text, word: candidate.english, correct: false,
      }));
      return [...new Map(labels.map((option) => [normalize(option.text), option])).values()];
    }
    let unique = uniqueOptions(bank[category(entry)]);
    // Small themes may not contain four words of the same part of speech.
    // Broaden only the grammatical category, never the topic or frequency level.
    if (unique.length < 3 && bank.fallback) unique = uniqueOptions(bank[category(entry)].concat(bank.fallback));
    if (unique.length < 3) throw new Error(`Недостаточно вариантов для ${entry.word}`);
    const distractors = shuffle(unique, random).slice(0, 3);
    return shuffle([{ text: correctText, word: entry.word, correct: true }, ...distractors], random);
  }

  class Session {
    constructor(words, bank, random = Math.random, mode = "en-ru", format = "full", answerMode = "choice", level = "5000", topic = "all") {
      if (!words.length) throw new Error("Список слов пуст");
      checkMode(mode);
      if (!hasOwn(FORMATS, format)) throw new Error(`Неизвестный формат: ${format}`);
      if (!hasOwn(ANSWER_MODES, answerMode)) throw new Error(`Неизвестный способ ответа: ${answerMode}`);
      const formatLimit = FORMATS[format].limit;
      if (formatLimit !== null && words.length < formatLimit) throw new Error(`Для этого формата нужно не менее ${formatLimit} слов`);
      const levelWords = wordsForLevel(words, level);
      // The topic is filtered AFTER the top-N frequency cutoff, before shuffling.
      this.vocabulary = wordsForTopic(levelWords, topic);
      if (!this.vocabulary.length) throw new Error("В этой теме нет слов выбранного уровня");
      const limit = formatLimit === null ? this.vocabulary.length : Math.min(formatLimit, this.vocabulary.length);
      this.level = String(level);
      this.levelSize = levelWords.length;
      this.topic = topic;
      this.vocabularySize = this.vocabulary.length;
      this.order = shuffle(this.vocabulary, random).slice(0, limit);
      this.bank = answerMode === "choice" ? bankForVocabulary(this.vocabulary, bank, topic !== "all") : null;
      this.random = random;
      this.mode = mode;
      this.format = format;
      this.answerMode = answerMode;
      this.englishIndex = answerMode === "typing" && mode === "ru-en" ? buildEnglishIndex(this.vocabulary) : null;
      this.index = 0;
      this.correct = 0;
      this.answered = 0;
      this.incorrectWords = [];
      this.selected = null;
      this.attemptsUsed = 0;
      this.options = answerMode === "choice" ? optionsFor(this.entry, this.bank, random, mode) : [];
    }

    get entry() { return this.order[this.index]; }
    get prompt() { return this.finished ? "" : questionFor(this.entry, this.mode); }
    get total() { return this.order.length; }
    get finished() { return this.index >= this.total; }
    get mistakes() { return this.answered - this.correct; }
    get accuracy() { return this.answered ? Math.round(this.correct / this.answered * 100) : 0; }
    get attemptsLeft() { return Math.max(0, MAX_TYPING_ATTEMPTS - this.attemptsUsed); }

    answer(optionIndex) {
      if (this.answerMode !== "choice" || this.finished || this.selected !== null || !Number.isInteger(optionIndex)
          || optionIndex < 0 || optionIndex >= this.options.length) return null;
      return this._record(this.options[optionIndex].correct, optionIndex);
    }

    _record(correct, selected) {
      this.selected = selected;
      this.answered += 1;
      if (correct) this.correct += 1;
      else this.incorrectWords.push({ word: this.entry.word, translation: this.entry.translation });
      return { correct, word: this.entry.word, translation: this.entry.translation };
    }

    answerTyped(text) {
      if (this.answerMode !== "typing" || this.finished || this.selected !== null) return null;
      if (!normalizeAnswer(text)) return { correct: false, empty: true, attemptsLeft: this.attemptsLeft };
      this.attemptsUsed += 1;
      if (!matchesAnswer(this.entry, this.mode, text, this.englishIndex)) {
        if (this.attemptsLeft > 0) return { correct: false, retry: true, attemptsLeft: this.attemptsLeft };
        const failure = this._record(false, "exhausted");
        failure.exhausted = true;
        failure.attemptsLeft = 0;
        return failure;
      }
      const result = this._record(true, "typed");
      result.answer = text.trim();
      result.attemptsLeft = this.attemptsLeft;
      return result;
    }

    skip() {
      if (this.answerMode !== "typing" || this.finished || this.selected !== null) return null;
      const result = this._record(false, "skipped");
      result.skipped = true;
      return result;
    }

    advance() {
      if (this.finished || this.selected === null) return false;
      this.index += 1;
      this.selected = null;
      this.attemptsUsed = 0;
      this.options = this.finished || this.answerMode === "typing" ? [] : optionsFor(this.entry, this.bank, this.random, this.mode);
      return true;
    }
  }

  return { MODES, FORMATS, ANSWER_MODES, MAX_TYPING_ATTEMPTS, LEVELS, TOPICS, wordsForLevel, wordsForTopic, wordCount, bankForVocabulary, shuffle, normalize, normalizeAnswer, primaryTranslation,
    translationVariants, buildEnglishIndex, matchesAnswer, questionFor, correctFor, category, optionsFor, Session };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Quiz;
