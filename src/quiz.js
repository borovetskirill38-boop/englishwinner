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

  const numbers = new Set([
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "hundred", "thousand", "million", "millions", "thousands",
  ]);

  function category(entry) {
    const first = primaryTranslation(entry);
    if (numbers.has(entry.word)) return "number";
    if (/(ть|ться|ти|чь)$/.test(first)) return "verb";
    if (/(ый|ий|ой|ая|ое|ые|ущий|ющий|ящий|щийся|вшийся)$/.test(first)) return "adjective";
    if (/^(\S+(о|но|ко)|в\s.+|на\s.+|по\S+)$/.test(first)) return "adverb";
    return "noun";
  }

  function optionsFor(entry, bank, random = Math.random) {
    const correctText = primaryTranslation(entry);
    const aliases = normalize(entry.translation).split(/[;(),]/).map((s) => s.trim());
    const candidates = bank[category(entry)].filter((candidate) => {
      if ((candidate.exclude || []).includes(entry.word)) return false;
      return !aliases.includes(normalize(candidate.text));
    });
    const unique = [...new Map(candidates.map((c) => [normalize(c.text), c])).values()];
    if (unique.length < 3) throw new Error(`Недостаточно вариантов для ${entry.word}`);
    const distractors = shuffle(unique, random).slice(0, 3).map((c) => ({
      text: c.text,
      correct: false,
    }));
    return shuffle([{ text: correctText, correct: true }, ...distractors], random);
  }

  class Session {
    constructor(words, bank, random = Math.random) {
      if (!words.length) throw new Error("Список слов пуст");
      this.order = shuffle(words, random);
      this.bank = bank;
      this.random = random;
      this.index = 0;
      this.correct = 0;
      this.answered = 0;
      this.selected = null;
      this.options = optionsFor(this.entry, bank, random);
    }

    get entry() { return this.order[this.index]; }
    get total() { return this.order.length; }
    get finished() { return this.index >= this.total; }
    get mistakes() { return this.answered - this.correct; }
    get accuracy() { return this.answered ? Math.round(this.correct / this.answered * 100) : 0; }

    answer(optionIndex) {
      if (this.finished || this.selected !== null || !Number.isInteger(optionIndex)
          || optionIndex < 0 || optionIndex >= this.options.length) return null;
      this.selected = optionIndex;
      this.answered += 1;
      const correct = this.options[optionIndex].correct;
      if (correct) this.correct += 1;
      return { correct, translation: this.entry.translation };
    }

    advance() {
      if (this.finished || this.selected === null) return false;
      this.index += 1;
      this.selected = null;
      this.options = this.finished ? [] : optionsFor(this.entry, this.bank, this.random);
      return true;
    }
  }

  return { shuffle, normalize, primaryTranslation, category, optionsFor, Session };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Quiz;
