/* Build one portable HTML file using only the Node.js standard library. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const fail = (message) => { throw new Error(message); };
const WORD_COUNT = 5000;

function loadData() {
  const source = JSON.parse(read("data/source.json"));
  if (source.count !== WORD_COUNT) fail(`Источник должен содержать ${WORD_COUNT} слов`);
  const frequency = read("data/frequency-source.txt");
  const digest = crypto.createHash("sha256").update(frequency).digest("hex");
  if (digest !== source.excerptSha256) fail("Изменился исходный частотный список");
  const excluded = new Set(read("data/excluded.txt").split(/\s+/).filter(Boolean));
  const translations = new Map();
  const answerAliases = JSON.parse(read("data/answer-aliases.json"));
  for (const line of read("data/translations.tsv").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [word, translation, ...extra] = line.split("\t");
    if (!word || !translation || extra.length || translations.has(word)) {
      fail(`Некорректная или повторная строка перевода: ${word}`);
    }
    if (!/[а-яё]/i.test(translation)) fail(`Нет русского перевода: ${word}`);
    translations.set(word, translation);
  }
  const words = [];
  frequency.trimEnd().split("\n").forEach((line, index) => {
    const match = /^(\S+) (\d+)$/.exec(line);
    if (!match) fail(`Неверная строка частотности: ${index + 1}`);
    const [, word, count] = match;
    if (!/^[a-z]+$/.test(word) || (word.length === 1 && !["i", "a"].includes(word))
        || excluded.has(word) || words.length >= WORD_COUNT) return;
    if (!translations.has(word)) fail(`Нет перевода для ${word}`);
    words.push({ word, translation: translations.get(word), frequency: Number(count), rank: index + 1,
      ...(answerAliases[word] ? {
        aliases: [].concat(...Object.values(answerAliases[word])), meaningAliases: answerAliases[word],
      } : {}) });
  });
  if (words.length !== WORD_COUNT || translations.size !== WORD_COUNT) fail(`Должно быть ровно ${WORD_COUNT} слов`);
  if (new Set(words.map((w) => w.word)).size !== words.length) fail("Слова повторяются");
  for (const [word, senses] of Object.entries(answerAliases)) {
    const translation = translations.get(word);
    if (!translation || !senses || typeof senses !== "object" || Array.isArray(senses) || !Object.keys(senses).length) {
      fail(`Некорректные дополнительные переводы: ${word}`);
    }
    const meanings = translation.split(";").map((text) => text.trim());
    for (const [meaning, aliases] of Object.entries(senses)) {
      if (!meanings.includes(meaning) || !Array.isArray(aliases) || !aliases.length
          || new Set(aliases.map((text) => typeof text === "string" ? text.toLocaleLowerCase("ru").replace(/ё/g, "е") : text)).size !== aliases.length
          || aliases.some((alias) => typeof alias !== "string" || alias !== alias.trim() || !/[а-яё]/i.test(alias))) {
        fail(`Некорректные дополнительные переводы: ${word} / ${meaning}`);
      }
    }
  }
  const bank = JSON.parse(read("data/distractors.json"));
  const quiz = require("../src/quiz.js");
  const topicGroups = JSON.parse(read("data/topics.json"));
  const byWord = new Map(words.map((entry) => [entry.word, entry]));
  const seenTopics = new Set();
  for (const entry of words) entry.topics = [];
  for (const group of topicGroups) {
    if (group.id === "all" || !Object.prototype.hasOwnProperty.call(quiz.TOPICS, group.id)
        || seenTopics.has(group.id) || !Array.isArray(group.words) || !group.words.length) {
      fail(`Некорректная или повторная тема: ${group.id}`);
    }
    seenTopics.add(group.id);
    const seenWords = new Set();
    for (const word of group.words) {
      if (!byWord.has(word) || seenWords.has(word)) fail(`Неизвестное или повторное слово в теме ${group.id}: ${word}`);
      seenWords.add(word);
      byWord.get(word).topics.push(group.id);
    }
  }
  for (const id of Object.keys(quiz.TOPICS).filter((id) => id !== "all")) {
    if (!seenTopics.has(id)) fail(`Нет разметки для темы: ${id}`);
  }
  for (const entry of words) {
    if (!entry.topics.length) fail(`Слово не распределено по темам: ${entry.word}`);
  }
  const topicTranslations = JSON.parse(read("data/topic-translations.json"));
  for (const [word, overrides] of Object.entries(topicTranslations)) {
    const entry = byWord.get(word);
    if (!entry || !overrides || typeof overrides !== "object" || Array.isArray(overrides)) fail(`Некорректные значения по темам: ${word}`);
    const meanings = entry.translation.split(";").map((text) => text.trim());
    for (const [topic, selected] of Object.entries(overrides)) {
      if (!entry.topics.includes(topic) || !Array.isArray(selected) || !selected.length
          || new Set(selected).size !== selected.length || selected.some((text) => !meanings.includes(text))) {
        fail(`Некорректное тематическое значение: ${word} / ${topic}`);
      }
    }
    entry.topicTranslations = overrides;
  }
  for (const candidates of Object.values(bank)) {
    for (const candidate of candidates) {
      if (!candidate.text || !/^[a-z]+(?:[ -][a-z]+)*$/.test(candidate.english || "")) {
        fail(`Нужны русский и английский варианты: ${candidate.text}`);
      }
    }
  }
  for (const level of Object.keys(quiz.LEVELS)) {
    const vocabulary = quiz.wordsForLevel(words, level);
    const scopedBank = quiz.bankForVocabulary(vocabulary, bank);
    for (const mode of Object.keys(quiz.MODES)) {
      for (const word of vocabulary) quiz.optionsFor(word, scopedBank, Math.random, mode);
    }
  }
  return { words, distractors: bank, source };
}

function build() {
  const data = loadData();
  const template = read("src/index.template.html");
  const tokens = {
    "{{STYLES}}": read("src/styles.css"),
    "{{DATA}}": JSON.stringify(data).replaceAll("<", "\\u003c"),
    "{{SCRIPT}}": read("src/quiz.js") + "\n" + read("src/app.js"),
  };
  let html = template;
  for (const [token, value] of Object.entries(tokens)) {
    if (html.split(token).length !== 2) fail(`В шаблоне должен быть один маркер ${token}`);
    html = html.replace(token, () => value);
  }
  return html;
}

if (require.main === module) {
  const html = build();
  if (process.argv.includes("--check")) {
    if (read("index.html") !== html) fail("index.html устарел. Выполните npm run build");
    console.log(`index.html актуален; ${WORD_COUNT} уникальных слов, три уровня и оба направления проверены.`);
  } else {
    fs.writeFileSync(path.join(root, "index.html"), html);
    console.log(`Собран index.html: ${WORD_COUNT} слов, ${Buffer.byteLength(html)} байт. Интернет не нужен.`);
  }
}

module.exports = { build, loadData };
