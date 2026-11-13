/* Fixed expressions and phrasal verbs: no browser or word-quiz dependencies. */
function createPhraseQuiz(language) {
  "use strict";
  if (language === undefined) language = "en";
  if (!["en", "es"].includes(language)) throw new Error(`Неизвестный язык: ${language}`);
  const FORWARD = `${language}-ru`;
  const REVERSE = `ru-${language}`;
  const LANGUAGE = Object.freeze({ code: language, name: language === "es" ? "Испанский" : "Английский" });

  const COLLECTIONS = Object.freeze({
    expressions: "Устойчивые выражения",
    "phrasal-verbs": language === "es" ? "Глагольные конструкции" : "Фразовые глаголы",
  });
  const MODES = Object.freeze({ [FORWARD]: `${LANGUAGE.name} → русский`, [REVERSE]: `Русский → ${language === "es" ? "испанский" : "английский"}` });
  const FORMATS = Object.freeze({ full: "Полный тест", express: "Экспресс-тест" });

  function hasOwn(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

  function normalize(text) {
    return text.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е")
      .replace(/[’‘]/g, "'").replace(/[.,!?¿¡…:;«»"“”]/g, " ").replace(/\s+/g, " ").trim();
  }

  function meanings(entry) {
    return entry.translation.split(";").map((text) => normalize(text.replace(/\([^)]*\)/g, " "))).filter(Boolean);
  }

  function shuffle(items, random = Math.random) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function checkMode(mode) {
    if (!hasOwn(MODES, mode)) throw new Error(`Неизвестное направление: ${mode}`);
  }

  function buildExclusionIndex(groups) {
    const index = new Map();
    for (const group of groups) {
      const family = new Set(group.map(normalize));
      for (const phrase of family) {
        const related = index.get(phrase);
        if (related) related.forEach((other) => family.add(other));
      }
      family.forEach((phrase) => index.set(phrase, family));
    }
    return index;
  }

  function optionsFor(entry, vocabulary, random = Math.random, mode = FORWARD, exclusions = new Map()) {
    checkMode(mode);
    const target = new Set(meanings(entry));
    const family = exclusions.get(normalize(entry.english));
    const label = (candidate) => mode === FORWARD ? candidate.translation : candidate.english;
    const candidates = new Map();
    for (const candidate of vocabulary) {
      if (normalize(candidate.english) === normalize(entry.english)) continue;
      if (family && family.has(normalize(candidate.english))) continue;
      if (meanings(candidate).some((meaning) => target.has(meaning))) continue;
      const text = label(candidate);
      if (normalize(text) === normalize(label(entry))) continue;
      candidates.set(normalize(text), { english: candidate.english, translation: candidate.translation, text, correct: false });
    }
    if (candidates.size < 3) throw new Error(`Недостаточно разных вариантов для ${entry.english}`);
    const choices = shuffle([...candidates.values()], random).slice(0, 3);
    choices.push({ english: entry.english, translation: entry.translation, text: label(entry), correct: true });
    return shuffle(choices, random);
  }

  class Session {
    constructor(data, collection = "expressions", mode = FORWARD, format = "express", random = Math.random) {
      if (!hasOwn(COLLECTIONS, collection)) throw new Error(`Неизвестный набор: ${collection}`);
      checkMode(mode);
      if (!hasOwn(FORMATS, format)) throw new Error(`Неизвестный формат: ${format}`);
      const vocabulary = data && data[collection];
      if (!Array.isArray(vocabulary) || vocabulary.length !== 500) throw new Error("В наборе должно быть ровно 500 выражений");
      if (vocabulary.some((entry) => !entry || typeof entry.english !== "string" || !entry.english.trim()
          || typeof entry.translation !== "string" || !entry.translation.trim())) throw new Error("В наборе есть пустая запись");
      if (new Set(vocabulary.map((entry) => normalize(entry.english))).size !== 500) throw new Error("В наборе есть повторяющиеся выражения");
      this.collection = collection;
      this.mode = mode;
      this.format = format;
      this.random = random;
      this.exclusions = buildExclusionIndex(data.exclusions && data.exclusions[collection] || []);
      this.vocabulary = vocabulary.slice();
      this.order = shuffle(this.vocabulary, random).slice(0, format === "express" ? 20 : 500);
      this.index = 0;
      this.selected = null;
      this.answered = 0;
      this.correct = 0;
      this.incorrectEntries = [];
      this.options = optionsFor(this.entry, this.vocabulary, random, mode, this.exclusions);
    }

    get entry() { return this.order[this.index]; }
    get prompt() { return this.finished ? "" : (this.mode === FORWARD ? this.entry.english : this.entry.translation); }
    get total() { return this.order.length; }
    get finished() { return this.index >= this.total; }
    get mistakes() { return this.answered - this.correct; }
    get accuracy() { return this.answered ? Math.round(this.correct / this.answered * 100) : 0; }

    answer(optionIndex) {
      if (this.finished || this.selected !== null || !Number.isInteger(optionIndex)
          || optionIndex < 0 || optionIndex >= this.options.length) return null;
      const option = this.options[optionIndex];
      this.selected = optionIndex;
      this.answered += 1;
      if (option.correct) this.correct += 1;
      else this.incorrectEntries.push(this.entry);
      return { correct: option.correct, english: this.entry.english, translation: this.entry.translation, selected: option };
    }

    advance() {
      if (this.finished || this.selected === null) return false;
      this.index += 1;
      this.selected = null;
      this.options = this.finished ? [] : optionsFor(this.entry, this.vocabulary, this.random, this.mode, this.exclusions);
      return true;
    }
  }

  return { FORWARD, REVERSE, LANGUAGE, forLanguage: createPhraseQuiz, COLLECTIONS, MODES, FORMATS, normalize, shuffle, optionsFor, Session };
}

const PhraseQuiz = createPhraseQuiz(typeof LEARNING_LANGUAGE === "string" ? LEARNING_LANGUAGE : "en");

if (typeof module !== "undefined" && module.exports) module.exports = PhraseQuiz;
