"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Quiz = require("../src/quiz.js");
const { build, loadData } = require("../scripts/build.js");
const data = loadData();

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test("exactly 2000 translated unique words, selected in source frequency order", () => {
  const { words } = data;
  assert.equal(words.length, 2000);
  assert.equal(new Set(words.map((w) => w.word)).size, 2000);
  assert.ok(words.some((w) => w.word === "i"));
  assert.ok(words.some((w) => w.word === "a"));
  assert.ok(!words.some((w) => w.word === "john" || w.word === "didn"));
  for (const [i, word] of words.entries()) {
    assert.match(word.word, /^[a-z]+$/);
    assert.match(word.translation, /[а-яё]/i);
    assert.ok(word.frequency > 0);
    if (i) {
      assert.ok(words[i - 1].frequency >= word.frequency);
      assert.ok(words[i - 1].rank < word.rank);
    }
  }
});

test("every word has four distinct options and exactly one correct translation", () => {
  const positions = [0, 0, 0, 0];
  const random = seeded(413);
  for (let pass = 0; pass < 4; pass += 1) {
    for (const word of data.words) {
      const options = Quiz.optionsFor(word, data.distractors, random);
      assert.equal(options.length, 4, word.word);
      assert.equal(new Set(options.map((o) => Quiz.normalize(o.text))).size, 4, word.word);
      assert.equal(options.filter((o) => o.correct).length, 1, word.word);
      assert.equal(options.find((o) => o.correct).text, Quiz.primaryTranslation(word));
      positions[options.findIndex((o) => o.correct)] += 1;
      const aliases = word.translation.split(/[;(),]/).map(Quiz.normalize);
      for (const option of options.filter((o) => !o.correct)) {
        assert.ok(!aliases.includes(Quiz.normalize(option.text)), `${word.word}: ${option.text}`);
      }
    }
  }
  assert.ok(positions.every((n) => n > 1700 && n < 2300), String(positions));
});

test("shuffle preserves items, does not mutate its input, and supports every position", () => {
  const items = ["a", "b", "c", "d"];
  const result = Quiz.shuffle(items, () => 0);
  assert.deepEqual(items, ["a", "b", "c", "d"]);
  assert.deepEqual(result, ["b", "c", "d", "a"]);
  const permutations = new Set();
  const random = seeded(123);
  for (let i = 0; i < 1000; i += 1) permutations.add(Quiz.shuffle(items, random).join(""));
  assert.equal(permutations.size, 24);
});

test("cannot advance before answering or change an answer after selection", () => {
  const session = new Quiz.Session(data.words, data.distractors, seeded(1));
  assert.equal(session.advance(), false);
  for (const invalid of [-1, 4, 0.5, "0", NaN]) assert.equal(session.answer(invalid), null);
  assert.equal(session.answered, 0);
  const correctIndex = session.options.findIndex((o) => o.correct);
  assert.equal(session.answer(correctIndex).correct, true);
  assert.equal(session.answer((correctIndex + 1) % 4), null);
  assert.equal(session.correct, 1);
  assert.equal(session.mistakes, 0);
  assert.equal(session.accuracy, 100);
  assert.equal(session.advance(), true);
  const wrongIndex = session.options.findIndex((o) => !o.correct);
  assert.equal(session.answer(wrongIndex).correct, false);
  assert.equal(session.answered, 2);
  assert.equal(session.correct, 1);
  assert.equal(session.mistakes, 1);
  assert.equal(session.accuracy, 50);
});

test("a complete pass covers each word once; fresh passes reset and reshuffle", () => {
  const random = seeded(900);
  const first = new Quiz.Session(data.words, data.distractors, random);
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) {
    assert.equal(first.finished, false);
    assert.ok(!seen.has(first.entry.word));
    seen.add(first.entry.word);
    first.answer(first.options.findIndex((o) => o.correct === (i % 2 === 0)));
    assert.equal(first.advance(), true);
  }
  assert.equal(seen.size, 2000);
  assert.equal(first.finished, true);
  assert.equal(first.correct, 1000);
  assert.equal(first.mistakes, 1000);
  assert.equal(first.accuracy, 50);
  assert.equal(first.answer(0), null);
  assert.equal(first.advance(), false);
  const previousOrder = first.order.map((w) => w.word);
  for (let i = 0; i < 5; i += 1) {
    const next = new Quiz.Session(data.words, data.distractors, random);
    assert.equal(next.answered, 0);
    assert.equal(next.correct, 0);
    assert.equal(next.selected, null);
    assert.equal(next.finished, false);
    assert.equal(new Set(next.order.map((w) => w.word)).size, 2000);
    assert.notDeepEqual(next.order.map((w) => w.word), previousOrder);
    assert.notDeepEqual(next.order.map((w) => w.word), data.words.map((w) => w.word));
  }
});

test("portable HTML is current and includes all data without external runtime dependencies", () => {
  const html = build();
  assert.equal(html, fs.readFileSync(path.join(__dirname, "../index.html"), "utf8"));
  assert.ok(html.startsWith("<!doctype html>"));
  assert.match(html, /<html lang="ru">/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+(?:stylesheet|preload)|@import|fetch\(/i);
  const embedded = JSON.parse(/<script id="vocabulary-data" type="application\/json">(.*?)<\/script>/s.exec(html)[1]);
  assert.equal(embedded.words.length, 2000);
  assert.deepEqual(embedded.words, data.words);
  assert.match(html, /CC BY-SA 4\.0/);
});
