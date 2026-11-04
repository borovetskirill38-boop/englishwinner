"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Quiz = require("../src/quiz.js");
const { loadData } = require("../scripts/build.js");
const { words, distractors } = loadData();
const groups = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/topics.json"), "utf8"));
const topicTranslations = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/topic-translations.json"), "utf8"));
const byWord = new Map(words.map((entry) => [entry.word, entry]));

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test("all 5000 words have explicit valid topic tags; all-topics keeps each word once", () => {
  assert.equal(groups.length, 21);
  const metadata = new Map(words.map((entry) => [entry.word, []]));
  for (const group of groups) {
    assert.ok(Quiz.TOPICS[group.id]);
    assert.equal(group.words.length, new Set(group.words).size);
    for (const word of group.words) {
      assert.ok(metadata.has(word));
      metadata.get(word).push(group.id);
    }
  }
  for (const entry of words) {
    assert.ok(entry.topics.length > 0, entry.word);
    assert.deepEqual(entry.topics, metadata.get(entry.word));
  }
  const all = Quiz.wordsForTopic(words, "all");
  assert.deepEqual(all, words);
  assert.equal(new Set(all.map((entry) => entry.word)).size, 5000);
  assert.ok(words.some((entry) => entry.topics.length > 1));
});

test("themes include verbs, adjectives, adverbs, numerals and grammatical words alongside nouns", () => {
  const examples = [
    ["home", "house"], ["home", "clean"], ["family", "father"], ["family", "married"],
    ["food", "food"], ["food", "eat"], ["food", "hungry"], ["work", "working"],
    ["work", "officially"], ["health", "physically"], ["time", "ten"],
    ["basics", "the"], ["basics", "and"], ["basics", "you"], ["basics", "can"],
    ["nature", "sunny"], ["education", "learn"], ["travel", "drive"],
  ];
  for (const [topic, word] of examples) assert.ok(byWord.get(word).topics.includes(topic), `${word}: ${topic}`);
});

for (const level of ["1000", "3000", "5000"]) {
  const prefix = words.slice(0, Number(level));
  const inLevel = new Set(prefix.map((entry) => entry.word));
  for (const group of groups) {
    const declared = new Set(group.words);
    const expected = prefix.filter((entry) => declared.has(entry.word)).map((entry) => {
      const meanings = topicTranslations[entry.word] && topicTranslations[entry.word][group.id];
      return meanings ? Object.assign({}, entry, { translation: meanings.join("; "), aliases: [] }) : entry;
    });
    const allowed = new Map(expected.map((entry) => [entry.word, entry]));
    const englishIndex = Quiz.buildEnglishIndex(expected);

    test(`${level}, ${group.id}: frequency cutoff precedes topic selection in all eight modes`, () => {
      const selected = Quiz.wordsForTopic(Quiz.wordsForLevel(words.slice().reverse(), level), group.id);
      assert.deepEqual(selected, expected);
      assert.ok(expected.length > 0);
      for (const mode of ["en-ru", "ru-en"]) {
        for (const format of ["full", "express"]) {
          for (const answerMode of ["choice", "typing"]) {
            const session = new Quiz.Session(words, distractors, seeded(503), mode, format, answerMode, level, group.id);
            const total = format === "full" ? expected.length : Math.min(20, expected.length);
            assert.equal(session.total, total);
            assert.equal(session.levelSize, Number(level));
            assert.equal(session.topic, group.id);
            assert.equal(session.vocabularySize, expected.length);
            assert.deepEqual(session.vocabulary, expected);
            const seen = new Set();
            for (let index = 0; index < total; index += 1) {
              const entry = session.entry;
              assert.ok(inLevel.has(entry.word));
              assert.ok(allowed.has(entry.word));
              assert.ok(!seen.has(entry.word));
              seen.add(entry.word);
              if (answerMode === "choice") {
                assert.equal(session.options.length, 4);
                assert.equal(new Set(session.options.map((option) => option.text)).size, 4);
                assert.equal(session.options.filter((option) => option.correct).length, 1);
                for (const option of session.options) {
                  assert.ok(allowed.has(option.word), `${group.id}, ${level}: unexpected option ${option.word}`);
                  const source = allowed.get(option.word);
                  assert.equal(option.text, mode === "ru-en" ? source.word : Quiz.primaryTranslation(source));
                  assert.equal(Quiz.matchesAnswer(entry, mode, option.text, englishIndex), option.correct,
                    `ambiguous: ${entry.word} / ${option.text}`);
                }
                session.answer(session.options.findIndex((option) => option.correct === (index % 2 === 0)));
              } else {
                assert.equal(session.answerTyped("___wrong___").retry, true);
                assert.equal(session.index, index);
                assert.equal(session.answered, index);
                if (index % 2) session.skip();
                else session.answerTyped(mode === "ru-en" ? entry.word : Quiz.translationVariants(entry)[0]);
              }
              assert.equal(session.advance(), true);
            }
            assert.equal(session.finished, true);
            assert.equal(session.correct, Math.ceil(total / 2));
            assert.equal(session.mistakes, Math.floor(total / 2));
            if (format === "full") assert.deepEqual(seen, new Set(allowed.keys()));
            const restart = new Quiz.Session(words, distractors, seeded(173), mode, format, answerMode, level, group.id);
            assert.equal(restart.total, total);
            assert.equal(restart.topic, group.id);
            assert.equal(restart.level, level);
            assert.equal(restart.answered, 0);
            assert.ok(restart.order.every((entry) => allowed.has(entry.word)));
          }
        }
      }
    });
  }
}

test("a small topic uses every available word in express, without importing higher-level words", () => {
  const session = new Quiz.Session(words, distractors, seeded(3), "en-ru", "express", "choice", "1000", "food");
  const expected = words.slice(0, 1000).filter((entry) => entry.topics.includes("food"));
  assert.ok(expected.length >= 4 && expected.length < 20);
  assert.equal(session.vocabularySize, expected.length);
  assert.equal(session.total, expected.length);
  assert.equal(new Set(session.order.map((entry) => entry.word)).size, expected.length);
  assert.ok(!session.order.some((entry) => entry.word === "pork"));
  assert.ok(Quiz.wordsForTopic(Quiz.wordsForLevel(words, "5000"), "food").some((entry) => entry.word === "pork"));
});

test("polysemous words use meanings of the selected topic without mutating the all-topics dictionary", () => {
  const cases = [["nature", "bank", "берег реки", "банк"], ["work", "book", "бронировать", "книга"],
    ["time", "watch", "наручные часы", "смотреть"], ["food", "glass", "стакан", "стекло"],
    ["qualities", "light", "лёгкий", "свет"], ["family", "date", "свидание", "дата"]];
  for (const [topic, word, correct, wrong] of cases) {
    const entry = Quiz.wordsForTopic(words, topic).find((item) => item.word === word);
    assert.equal(Quiz.primaryTranslation(entry), correct);
    assert.equal(Quiz.matchesAnswer(entry, "en-ru", correct), true);
    assert.equal(Quiz.matchesAnswer(entry, "en-ru", wrong), false);
    assert.ok(Quiz.translationVariants(byWord.get(word)).includes(wrong));
  }
  assert.equal(Quiz.primaryTranslation(byWord.get("bank")), "банк");
});

test("context meanings are explicit subsets of the original dictionary meanings", () => {
  for (const [word, overrides] of Object.entries(topicTranslations)) {
    const entry = byWord.get(word);
    const meanings = entry.translation.split(";").map((text) => text.trim());
    for (const [topic, selected] of Object.entries(overrides)) {
      assert.ok(entry.topics.includes(topic));
      assert.ok(selected.length > 0);
      assert.ok(selected.every((meaning) => meanings.includes(meaning)));
    }
  }
});

test("reverse-typing synonym lookup stays within both topic and frequency level", () => {
  for (const [level, word, outside] of [["1000", "just", "simply"], ["5000", "well", "nicely"]]) {
    const pool = Quiz.wordsForTopic(Quiz.wordsForLevel(words, level), "basics");
    let remaining = pool.length;
    const target = pool.findIndex((entry) => entry.word === word);
    const random = () => { remaining -= 1; return remaining === target ? 0 : 1 - Number.EPSILON; };
    const session = new Quiz.Session(words, distractors, random, "ru-en", "express", "typing", level, "basics");
    assert.equal(session.entry.word, word);
    assert.equal(session.answerTyped(outside).retry, true);
    assert.equal(session.index, 0);
    assert.equal(session.answerTyped(word).correct, true);
    assert.equal(Quiz.matchesAnswer(session.entry, "ru-en", outside, Quiz.buildEnglishIndex(words)), true);
  }
});

test("unknown and empty themes fail without falling back to a different topic or level", () => {
  for (const topic of ["missing", "toString", "__proto__", "", null]) {
    assert.throws(() => new Quiz.Session(words, distractors, Math.random, "en-ru", "full", "choice", "1000", topic), /Неизвестная тема/);
  }
  const empty = words.map((entry) => Object.assign({}, entry, { topics: [] }));
  for (const format of ["full", "express"]) {
    assert.throws(() => new Quiz.Session(empty, distractors, Math.random, "en-ru", format, "typing", "1000", "home"), /нет слов выбранного уровня/);
  }
  const single = empty.slice();
  single[0] = Object.assign({}, single[0], { topics: ["home"] });
  const session = new Quiz.Session(single, distractors, Math.random, "en-ru", "express", "typing", "1000", "home");
  assert.equal(session.total, 1);
  assert.equal(session.answerTyped(Quiz.translationVariants(session.entry)[0]).correct, true);
  assert.equal(session.advance(), true);
  assert.equal(session.finished, true);
  assert.throws(() => new Quiz.Session(single, distractors, Math.random, "en-ru", "full", "choice", "1000", "home"), /Недостаточно вариантов/);
});

test("word counts are displayed correctly for small themed selections", () => {
  for (const [count, label] of [[1, "1 слово"], [2, "2 слова"], [4, "4 слова"], [5, "5 слов"], [11, "11 слов"], [19, "19 слов"], [21, "21 слово"], [24, "24 слова"], [1000, "1000 слов"]]) {
    assert.equal(Quiz.wordCount(count), label);
  }
});
