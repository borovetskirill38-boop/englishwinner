"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Quiz = require("../src/quiz.js");
const { loadData } = require("../scripts/build.js");
const { words, distractors } = loadData();
const byWord = new Map(words.map((entry) => [entry.word, entry]));
const englishIndex = Quiz.buildEnglishIndex(words);

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test("typed Russian answers accept individual dictionary meanings, notes, case, whitespace and ё/е", () => {
  const examples = [
    ["dog", "  ПЕС!  "], ["cat", "КОТ"], ["car", "машина"],
    ["give", "дать"], ["go", "ходить"], ["the", "ОПРЕДЕЛЕННЫЙ   АРТИКЛЬ"],
    ["house", "дом"], ["house", "дом (здание)"], ["on", "на"],
    ["you", "вы"], ["cat", "кошка"],
  ];
  for (const [word, answer] of examples) {
    assert.equal(Quiz.matchesAnswer(byWord.get(word), "en-ru", answer), true, `${word}: ${answer}`);
  }
  assert.equal(Quiz.matchesAnswer(byWord.get("cat"), "en-ru", "собака"), false);
  assert.equal(Quiz.matchesAnswer(byWord.get("cat"), "en-ru", "кошк"), false);
  for (const empty of ["", "  ", "...", null, 123]) {
    assert.equal(Quiz.matchesAnswer(byWord.get("cat"), "en-ru", empty), false);
  }
});

test("reverse typing accepts matching English synonyms but preserves explicit sense and tense qualifiers", () => {
  for (const answer of ["job", "WORK", " work! "]) {
    assert.equal(Quiz.matchesAnswer(byWord.get("job"), "ru-en", answer, englishIndex), true);
  }
  assert.equal(Quiz.matchesAnswer(byWord.get("go"), "ru-en", "to go", englishIndex), true);
  assert.equal(Quiz.matchesAnswer(byWord.get("cat"), "ru-en", "dog", englishIndex), false);
  assert.equal(Quiz.matchesAnswer(byWord.get("cat"), "ru-en", "to cat", englishIndex), false);
  assert.equal(Quiz.matchesAnswer(byWord.get("hours"), "ru-en", "clock", englishIndex), false);
  assert.equal(Quiz.matchesAnswer(byWord.get("hours"), "ru-en", "hours", englishIndex), true);
  assert.equal(Quiz.matchesAnswer(byWord.get("gave"), "ru-en", "give", englishIndex), false);
  assert.equal(Quiz.matchesAnswer(byWord.get("gave"), "ru-en", "gave", englishIndex), true);
});

test("every one of the 3000 words accepts each listed Russian meaning and its canonical English answer", () => {
  for (const entry of words) {
    for (const answer of Quiz.translationVariants(entry)) {
      assert.equal(Quiz.matchesAnswer(entry, "en-ru", answer), true, `${entry.word}: ${answer}`);
    }
    assert.equal(Quiz.matchesAnswer(entry, "ru-en", entry.word, englishIndex), true, entry.word);
    assert.equal(Quiz.matchesAnswer(entry, "ru-en", "___wrong___", englishIndex), false, entry.word);
    assert.equal(Quiz.matchesAnswer(entry, "en-ru", "___wrong___"), false, entry.word);
  }
});

test("express reverse typing uses synonyms from the full dictionary, including outside its 20-word sample", () => {
  const pool = [byWord.get("job"), ...words.filter((entry) => !["job", "work"].includes(entry.word)).slice(0, 19), byWord.get("work")];
  const session = new Quiz.Session(pool, distractors, () => 1 - Number.EPSILON, "ru-en", "express", "typing");
  assert.equal(session.entry.word, "job");
  assert.equal(session.order.some((entry) => entry.word === "work"), false);
  assert.equal(session.answerTyped("work").correct, true);
  assert.equal(session.correct, 1);
});

for (const mode of Object.keys(Quiz.MODES)) {
  for (const format of Object.keys(Quiz.FORMATS)) {
    test(`${mode}, ${format}: retries stay on the word; only a correct answer or skip is scored once`, () => {
      const session = new Quiz.Session(words, distractors, seeded(981), mode, format, "typing");
      const total = format === "express" ? 20 : 3000;
      assert.equal(session.total, total);
      assert.equal(session.answerMode, "typing");
      const seen = new Set();
      for (let i = 0; i < total; i += 1) {
        assert.equal(session.finished, false);
        assert.equal(session.advance(), false);
        assert.deepEqual(session.options, []);
        assert.equal(session.answer(0), null);
        assert.equal(session.answerTyped("").empty, true);
        const entry = session.entry;
        assert.ok(!seen.has(entry.word));
        seen.add(entry.word);
        for (let attempt = 0; attempt < 2; attempt += 1) {
          assert.equal(session.answerTyped("___wrong___").retry, true);
          assert.equal(session.entry, entry);
          assert.equal(session.index, i);
          assert.equal(session.answered, i);
          assert.equal(session.selected, null);
          assert.equal(session.advance(), false);
        }
        if (i % 2 === 0) {
          const answer = mode === "en-ru" ? Quiz.translationVariants(entry)[0] : entry.word;
          assert.equal(session.answerTyped(answer).correct, true);
          assert.equal(session.answerTyped(answer), null);
          assert.equal(session.skip(), null);
        } else {
          assert.equal(session.skip().skipped, true);
          assert.equal(session.skip(), null);
          assert.equal(session.answerTyped(entry.word), null);
        }
        assert.equal(session.answered, i + 1);
        assert.equal(session.correct, Math.floor(i / 2) + 1);
        assert.equal(session.mistakes, Math.floor((i + 1) / 2));
        assert.equal(session.advance(), true);
      }
      assert.equal(seen.size, total);
      assert.equal(session.finished, true);
      assert.equal(session.correct, total / 2);
      assert.equal(session.mistakes, total / 2);
      assert.equal(session.accuracy, 50);
      assert.equal(session.skip(), null);
      assert.equal(session.answerTyped("word"), null);
      assert.equal(session.advance(), false);
      const restart = new Quiz.Session(words, distractors, seeded(777), mode, format, "typing");
      assert.equal(restart.answered, 0);
      assert.equal(restart.correct, 0);
      assert.equal(restart.mistakes, 0);
      assert.equal(restart.total, total);
      assert.equal(restart.selected, null);
    });
  }
}

test("choice mode retains its behavior and refuses typed submissions and skips", () => {
  const session = new Quiz.Session(words, distractors, seeded(52));
  assert.equal(session.answerMode, "choice");
  assert.equal(session.answerTyped("word"), null);
  assert.equal(session.skip(), null);
  assert.equal(session.answered, 0);
  assert.equal(session.answer(session.options.findIndex((option) => option.correct)).correct, true);
});

test("unknown answer modes are rejected", () => {
  for (const answerMode of ["other", "toString", "", 5]) {
    assert.throws(() => new Quiz.Session(words, distractors, Math.random, "en-ru", "full", answerMode), /Неизвестный способ ответа/);
  }
});
