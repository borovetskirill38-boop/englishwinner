/* Shared validation for frequency-ranked language datasets. Builds stay offline. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
function createDataset({ language, directory, wordPattern, singleLetters, label }) {
  const Quiz = require("../src/quiz.js").forLanguage(language);
  const root = path.resolve(__dirname, "..");
  const read = (name) => fs.readFileSync(path.join(root, "data", directory, name), "utf8");
  const fail = (message) => { throw new Error(`${label}: ${message}`); };

  function loadData() {
    const source = JSON.parse(read("source.json"));
    const frequency = read("frequency-source.txt");
    if (crypto.createHash("sha256").update(frequency).digest("hex") !== source.excerptSha256) fail("изменился исходный частотный список");
    const excluded = new Set(read("excluded.txt").split(/\s+/).filter(Boolean));
    const selected = frequency.trim().split("\n").map((line, index) => {
      const match = /^(\S+) (\d+)$/.exec(line);
      if (!match) fail(`неверная строка частотности ${index + 1}`);
      return { word: match[1], frequency: Number(match[2]), rank: index + 1 };
    }).filter((entry) => wordPattern.test(entry.word) && (entry.word.length > 1 || singleLetters.includes(entry.word))
        && !excluded.has(entry.word)).slice(0, 5000);
    const words = JSON.parse(read("vocabulary.json"));
    if (source.count !== 5000 || words.length !== 5000 || selected.length !== 5000) fail("нужно ровно 5000 слов");
    const topics = new Set(Object.keys(Quiz.TOPICS).filter((topic) => topic !== "all"));
    const categories = ["noun", "verb", "adjective", "adverb", "number"];
    const seen = new Set();
    for (const [index, entry] of words.entries()) {
      const expected = selected[index];
      if (entry.word !== expected.word || entry.frequency !== expected.frequency || entry.rank !== expected.rank) fail(`нарушен частотный порядок: ${entry.word}`);
      if (seen.has(entry.word)) fail(`повтор слова ${entry.word}`);
      seen.add(entry.word);
      if (typeof entry.translation !== "string" || !/[а-яё]/i.test(entry.translation) || /__|\bREVIEW\b|[a-z]/i.test(entry.translation)) fail(`непроверенный перевод ${entry.word}`);
      if (!categories.includes(entry.category)) fail(`неверная часть речи ${entry.word}`);
      if (entry.choiceFamily !== undefined && (typeof entry.choiceFamily !== "string" || !wordPattern.test(entry.choiceFamily))) fail(`неверная группа словоформ ${entry.word}`);
      if (!Array.isArray(entry.topics) || !entry.topics.length || new Set(entry.topics).size !== entry.topics.length || entry.topics.some((topic) => !topics.has(topic))) fail(`неверные темы ${entry.word}`);
      const meanings = entry.translation.split(";").map((meaning) => meaning.trim());
      if (meanings.some((meaning) => !meaning) || new Set(meanings).size !== meanings.length) fail(`повтор или пустое значение ${entry.word}`);
      if (entry.aliases && (!Array.isArray(entry.aliases) || entry.aliases.some((value) => typeof value !== "string" || !/[а-яё]/i.test(value)))) fail(`неверный синоним ${entry.word}`);
      for (const [meaning, aliases] of Object.entries(entry.meaningAliases || {})) {
        if (!meanings.includes(meaning) || !Array.isArray(aliases) || aliases.some((value) => !entry.aliases.includes(value))) fail(`синоним не привязан к значению ${entry.word}`);
      }
      for (const [topic, selectedMeanings] of Object.entries(entry.topicTranslations || {})) {
        if (!entry.topics.includes(topic) || !Array.isArray(selectedMeanings) || !selectedMeanings.length || selectedMeanings.some((meaning) => !meanings.includes(meaning))) fail(`значение вне темы ${entry.word}/${topic}`);
      }
    }
    for (const topic of topics) if (!words.some((entry) => entry.topics.includes(topic))) fail(`не заполнена тема ${topic}`);
    // Keep a broad, bounded choice bank from each frequency prefix. Topic tests
    // use their complete scoped vocabulary through Quiz.bankForVocabulary.
    const bank = Object.fromEntries(categories.map((category) => [category, []]));
    for (const category of categories) {
      const chosen = new Map();
      for (const [start, end] of [[0, 1000], [1000, 3000], [3000, 5000]]) {
        for (const entry of words.slice(start, end).filter((word) => word.category === category).slice(0, 70)) chosen.set(entry.word, entry);
      }
      bank[category] = [...chosen.values()].map((entry) => ({ english: entry.word, text: Quiz.primaryTranslation(entry) }));
    }
    for (const level of Object.keys(Quiz.LEVELS)) {
      const vocabulary = Quiz.wordsForLevel(words, level);
      const scopedBank = Quiz.bankForVocabulary(vocabulary, bank);
      for (const entry of vocabulary) for (const mode of Object.keys(Quiz.MODES)) Quiz.optionsFor(entry, scopedBank, Math.random, mode);
    }
    return { words, distractors: bank, source };
  }

  function loadPhraseData() {
    const data = { exclusions: JSON.parse(read("phrase-exclusions.json")) };
    for (const [collection, file] of Object.entries({ expressions: "expressions.tsv", "phrasal-verbs": "verb-constructions.tsv" })) {
      data[collection] = read(file).trimEnd().split(/\r?\n/).map((line) => {
        const [english, translation, ...extra] = line.split("\t");
        if (!english || !translation || extra.length || english.trim() !== english || translation.trim() !== translation) fail(`неверная строка ${file}`);
        return { english, translation };
      });
    }
    const collections = ["expressions", "phrasal-verbs"];
    for (const collection of collections) {
      const entries = data[collection];
      if (!Array.isArray(entries) || entries.length !== 500 || new Set(entries.map((entry) => entry.english.normalize("NFKC").toLowerCase())).size !== 500) fail(`нужно 500 уникальных записей ${collection}`);
      for (const entry of entries) {
        if (typeof entry.english !== "string" || !/[a-záéíóúüñ]/i.test(entry.english) || !entry.english.includes(" ") || !/[а-яё]/i.test(entry.translation) || /__|REVIEW/.test(entry.translation)) fail(`неверное выражение ${entry.english}`);
      }
      const known = new Set(entries.map((entry) => entry.english));
      if (!Array.isArray(data.exclusions && data.exclusions[collection])) fail(`нет групп синонимов ${collection}`);
      for (const group of data.exclusions[collection]) {
        if (!Array.isArray(group) || group.length < 2 || group.some((phrase) => !known.has(phrase))) fail(`неверная группа ${collection}`);
      }
    }
    return data;
  }

  return { loadData, loadPhraseData };
}

module.exports = { createDataset };
