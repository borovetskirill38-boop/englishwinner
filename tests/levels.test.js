"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Quiz = require("../src/quiz.js");
const { loadData } = require("../scripts/build.js");
const { words, distractors } = loadData();

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

for (const level of ["1000", "3000", "5000"]) {
  const size = Number(level);
  const expected = words.slice(0, size);
  const allowed = new Map(expected.map((entry) => [entry.word, entry]));
  const englishIndex = Quiz.buildEnglishIndex(expected);

  test(`${level}: selects the top frequency ranks before shuffling and preserves source order`, () => {
    const reversed = words.slice().reverse();
    const session = new Quiz.Session(reversed, distractors, seeded(11), "en-ru", "full", "choice", level);
    assert.deepEqual(session.vocabulary, expected);
    assert.deepEqual(new Set(session.order), new Set(expected));
    assert.notDeepEqual(session.order, expected);
    assert.equal(reversed[0], words[words.length - 1]);
    assert.equal(session.vocabularySize, size);
    assert.equal(session.level, level);
  });

  for (const mode of ["en-ru", "ru-en"]) {
    for (const format of ["full", "express"]) {
      for (const answerMode of ["choice", "typing"]) {
        test(`${level}, ${mode}, ${format}, ${answerMode}: questions, choices and scoring stay within the level`, () => {
          const session = new Quiz.Session(words, distractors, seeded(91), mode, format, answerMode, level);
          const total = format === "full" ? size : 20;
          const seen = new Set();
          assert.equal(session.total, total);
          for (let index = 0; index < total; index += 1) {
            const entry = session.entry;
            assert.ok(allowed.has(entry.word), entry.word);
            assert.equal(allowed.get(entry.word), entry);
            assert.ok(!seen.has(entry.word));
            seen.add(entry.word);
            if (answerMode === "choice") {
              assert.equal(session.options.length, 4);
              assert.equal(new Set(session.options.map((option) => option.text)).size, 4);
              assert.equal(session.options.filter((option) => option.correct).length, 1);
              for (const option of session.options) {
                assert.ok(allowed.has(option.word), `out-of-level option: ${option.word}`);
                const source = allowed.get(option.word);
                assert.equal(option.text, mode === "ru-en" ? source.word : Quiz.primaryTranslation(source));
                assert.equal(Quiz.matchesAnswer(entry, mode, option.text, englishIndex), option.correct,
                  `ambiguous choice: ${entry.word} / ${option.text}`);
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
          assert.equal(seen.size, total);
          assert.equal(session.correct, total / 2);
          assert.equal(session.mistakes, total / 2);
          if (format === "full") assert.deepEqual(seen, new Set(allowed.keys()));
          const restart = new Quiz.Session(words, distractors, seeded(403), mode, format, answerMode, level);
          assert.equal(restart.level, level);
          assert.equal(restart.total, total);
          assert.equal(restart.answered, 0);
          assert.notDeepEqual(restart.order, session.order);
          assert.ok(restart.order.every((entry) => allowed.has(entry.word)));
        });
      }
    }
  }

  test(`${level}: repeated express tests can sample the frequency boundary without leaving the level`, () => {
    const random = seeded(912);
    const seen = new Set();
    for (let pass = 0; pass < 40; pass += 1) {
      const session = new Quiz.Session(words, distractors, random, "en-ru", "express", "choice", level);
      assert.equal(session.order.length, 20);
      for (const entry of session.order) {
        assert.ok(allowed.has(entry.word));
        seen.add(entry.word);
      }
    }
    assert.ok(expected.slice(-100).some((entry) => seen.has(entry.word)), "must reach the end of the selected level");
  });
}

test("reverse typing accepts synonyms from the level but rejects synonyms beyond its frequency cutoff", () => {
  for (const [level, word, outside] of [["1000", "just", "simply"], ["3000", "well", "nicely"]]) {
    for (const format of ["full", "express"]) {
      let remaining = Number(level);
      const target = words.findIndex((entry) => entry.word === word);
      const random = () => { remaining -= 1; return remaining === target ? 0 : 1 - Number.EPSILON; };
      const session = new Quiz.Session(words, distractors, random, "ru-en", format, "typing", level);
      assert.equal(session.entry.word, word);
      assert.equal(session.answerTyped(outside).retry, true);
      assert.equal(session.entry.word, word);
      assert.equal(session.answerTyped(word).correct, true);
      const fullIndex = Quiz.buildEnglishIndex(words);
      assert.equal(Quiz.matchesAnswer(session.entry, "ru-en", outside, fullIndex), true,
        "outside answer must otherwise be a recognized synonym");
    }
  }
});

test("unknown levels and incomplete level dictionaries are rejected", () => {
  for (const level of ["0", "2000", "1000x", "toString", "__proto__", "", null]) {
    assert.throws(() => new Quiz.Session(words, distractors, Math.random, "en-ru", "full", "choice", level), /Неизвестный уровень/);
  }
  assert.throws(() => new Quiz.Session(words.slice(0, 999), distractors, Math.random, "en-ru", "express", "choice", "1000"), /не менее 1000 слов/);
  assert.throws(() => new Quiz.Session(words.slice(0, 2999), distractors, Math.random, "en-ru", "full", "typing", "3000"), /не менее 3000 слов/);
});
