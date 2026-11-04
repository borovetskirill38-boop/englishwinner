"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Quiz = require("../src/quiz.js");
const { build, loadData } = require("../scripts/build.js");
const data = loadData();
const COUNT = 3000;

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test("exactly 3000 translated unique words, selected in source frequency order", () => {
  const { words } = data;
  assert.equal(words.length, COUNT);
  assert.equal(data.source.count, COUNT);
  assert.equal(new Set(words.map((w) => w.word)).size, COUNT);
  for (const expected of ["i", "a", "media", "activity", "knight"]) {
    assert.ok(words.some((w) => w.word === expected));
  }
  assert.ok(!words.some((w) => ["john", "didn", "claire"].includes(w.word)));
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

for (const mode of Object.keys(Quiz.MODES)) {
  test(`${mode}: all 3000 words have four distinct options in the answer language`, () => {
    const positions = [0, 0, 0, 0];
    const random = seeded(413);
    for (let pass = 0; pass < 4; pass += 1) {
      for (const word of data.words) {
        const options = Quiz.optionsFor(word, data.distractors, random, mode);
        assert.equal(options.length, 4, word.word);
        assert.equal(new Set(options.map((o) => Quiz.normalize(o.text))).size, 4, word.word);
        assert.equal(options.filter((o) => o.correct).length, 1, word.word);
        assert.equal(options.find((o) => o.correct).text, Quiz.correctFor(word, mode));
        assert.equal(Quiz.questionFor(word, mode), mode === "ru-en" ? Quiz.primaryTranslation(word) : word.word);
        positions[options.findIndex((o) => o.correct)] += 1;
        const aliases = word.translation.split(/[;(),]/).map(Quiz.normalize);
        for (const option of options) {
          if (mode === "ru-en") assert.match(option.text, /^[a-z]+(?:[ -][a-z]+)*$/);
          else assert.match(option.text, /[а-яё]/i);
          if (option.correct) continue;
          const candidate = Object.values(data.distractors).flat().find((c) =>
            (mode === "ru-en" ? c.english : c.text) === option.text);
          assert.ok(candidate);
          assert.ok(!(candidate.exclude || []).includes(word.word));
          assert.ok(!aliases.includes(Quiz.normalize(candidate.text)), `${word.word}: ${option.text}`);
          assert.notEqual(candidate.english, word.word);
        }
      }
    }
    assert.ok(positions.every((n) => n > COUNT * .85 && n < COUNT * 1.15), String(positions));
  });

  test(`${mode}: cannot advance early or change an answer after selection`, () => {
    const session = new Quiz.Session(data.words, data.distractors, seeded(1), mode);
    assert.equal(session.mode, mode);
    assert.equal(session.prompt, Quiz.questionFor(session.entry, mode));
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
    assert.equal(session.prompt, Quiz.questionFor(session.entry, mode));
    const wrongIndex = session.options.findIndex((o) => !o.correct);
    assert.equal(session.answer(wrongIndex).correct, false);
    assert.equal(session.answered, 2);
    assert.equal(session.correct, 1);
    assert.equal(session.mistakes, 1);
    assert.equal(session.accuracy, 50);
  });

  test(`${mode}: a complete pass covers each English word once; new passes reset and reshuffle`, () => {
    const random = seeded(900);
    const first = new Quiz.Session(data.words, data.distractors, random, mode);
    const seen = new Set();
    for (let i = 0; i < COUNT; i += 1) {
      assert.equal(first.finished, false);
      assert.ok(!seen.has(first.entry.word));
      seen.add(first.entry.word);
      assert.equal(first.prompt, Quiz.questionFor(first.entry, mode));
      first.answer(first.options.findIndex((o) => o.correct === (i % 2 === 0)));
      assert.equal(first.advance(), true);
    }
    assert.equal(seen.size, COUNT);
    assert.equal(first.finished, true);
    assert.equal(first.correct, COUNT / 2);
    assert.equal(first.mistakes, COUNT / 2);
    assert.equal(first.accuracy, 50);
    assert.equal(first.answer(0), null);
    assert.equal(first.advance(), false);
    const previousOrder = first.order.map((w) => w.word);
    for (let i = 0; i < 3; i += 1) {
      const next = new Quiz.Session(data.words, data.distractors, random, mode);
      assert.equal(next.mode, mode);
      assert.equal(next.answered, 0);
      assert.equal(next.correct, 0);
      assert.equal(next.selected, null);
      assert.equal(next.finished, false);
      assert.equal(new Set(next.order.map((w) => w.word)).size, COUNT);
      assert.notDeepEqual(next.order.map((w) => w.word), previousOrder);
      assert.notDeepEqual(next.order.map((w) => w.word), data.words.map((w) => w.word));
    }
  });
}

test("reverse questions keep synonyms out of distractors, including new vocabulary", () => {
  const words = [
    { word: "cock", translation: "петух; пенис" },
    { word: "freeze", translation: "замораживать; замерзать" },
    { word: "scratch", translation: "царапать; чесать" },
    { word: "underground", translation: "подземный; метро" },
  ];
  const bank = { ...data.distractors, noun: [
    ...data.distractors.noun,
    { text: "петух", english: "rooster" },
    { text: "петух", english: "cockerel" },
  ] };
  for (const entry of words) {
    const aliases = entry.translation.split(";").map(Quiz.normalize);
    for (const mode of Object.keys(Quiz.MODES)) {
      const random = seeded(991);
      for (let run = 0; run < 40; run += 1) {
        const options = Quiz.optionsFor(entry, bank, random, mode);
        assert.equal(options.filter((o) => o.correct).length, 1);
        for (const option of options.filter((o) => !o.correct)) {
          const candidate = Object.values(bank).flat().find((c) =>
            (mode === "ru-en" ? c.english : c.text) === option.text);
          assert.ok(!aliases.includes(Quiz.normalize(candidate.text)));
          assert.notEqual(candidate.english, entry.word);
        }
      }
    }
  }
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

test("the original direction remains the default; unknown modes are rejected", () => {
  const entry = data.words[0];
  const session = new Quiz.Session(data.words, data.distractors, seeded(123));
  assert.equal(session.mode, "en-ru");
  assert.equal(Quiz.questionFor(entry), entry.word);
  assert.equal(Quiz.correctFor(entry), Quiz.primaryTranslation(entry));
  for (const mode of ["other", "toString", ""]) {
    assert.throws(() => new Quiz.Session(data.words, data.distractors, Math.random, mode), /Неизвестный режим/);
    assert.throws(() => Quiz.optionsFor(entry, data.distractors, Math.random, mode), /Неизвестный режим/);
  }
});

test("portable HTML is current, has both modes and all 3000 words without external runtime dependencies", () => {
  const html = build();
  assert.equal(html, fs.readFileSync(path.join(__dirname, "../index.html"), "utf8"));
  assert.ok(html.startsWith("<!doctype html>"));
  assert.match(html, /<html lang="ru">/);
  assert.match(html, /type="radio" name="mode" value="en-ru"/);
  assert.match(html, /type="radio" name="mode" value="ru-en"/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+(?:stylesheet|preload)|@import|fetch\(/i);
  const embedded = JSON.parse(/<script id="vocabulary-data" type="application\/json">(.*?)<\/script>/s.exec(html)[1]);
  assert.equal(embedded.words.length, COUNT);
  assert.deepEqual(embedded.words, data.words);
  assert.match(html, /CC BY-SA 4\.0/);
});
