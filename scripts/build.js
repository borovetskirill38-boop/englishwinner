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
      ...(answerAliases[word] ? { aliases: answerAliases[word] } : {}) });
  });
  if (words.length !== WORD_COUNT || translations.size !== WORD_COUNT) fail(`Должно быть ровно ${WORD_COUNT} слов`);
  if (new Set(words.map((w) => w.word)).size !== words.length) fail("Слова повторяются");
  for (const [word, aliases] of Object.entries(answerAliases)) {
    if (!words.some((entry) => entry.word === word) || !Array.isArray(aliases)
        || aliases.some((alias) => typeof alias !== "string" || !/[а-яё]/i.test(alias))) {
      fail(`Некорректные дополнительные переводы: ${word}`);
    }
  }
  const bank = JSON.parse(read("data/distractors.json"));
  const quiz = require("../src/quiz.js");
  for (const candidates of Object.values(bank)) {
    for (const candidate of candidates) {
      if (!candidate.text || !/^[a-z]+(?:[ -][a-z]+)*$/.test(candidate.english || "")) {
        fail(`Нужны русский и английский варианты: ${candidate.text}`);
      }
    }
  }
  for (const mode of Object.keys(quiz.MODES)) {
    for (const word of words) quiz.optionsFor(word, bank, Math.random, mode);
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
    console.log(`index.html актуален; ${WORD_COUNT} уникальных слов и оба режима проверены.`);
  } else {
    fs.writeFileSync(path.join(root, "index.html"), html);
    console.log(`Собран index.html: ${WORD_COUNT} слов, ${Buffer.byteLength(html)} байт. Интернет не нужен.`);
  }
}

module.exports = { build, loadData };
