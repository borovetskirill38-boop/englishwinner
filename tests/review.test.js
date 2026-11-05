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

function answerFor(session) {
  return session.mode === "en-ru" ? Quiz.translationVariants(session.entry)[0] : session.entry.word;
}

for (const mode of Object.keys(Quiz.MODES)) {
  for (const answerMode of Object.keys(Quiz.ANSWER_MODES)) {
    test(`${mode}, ${answerMode}: express review contains every scored mistake once, in question order`, () => {
      for (const level of Object.keys(Quiz.LEVELS)) {
        for (const topic of ["all", "food", "work"]) {
          const session = new Quiz.Session(words, distractors, seeded(901), mode, "express", answerMode, level, topic);
          const expected = [];
          const allowed = Quiz.wordsForTopic(Quiz.wordsForLevel(words, level), topic);
          assert.deepEqual(session.incorrectWords, []);
          while (!session.finished) {
            const entry = session.entry;
            const pair = { word: entry.word, translation: entry.translation };
            assert.ok(allowed.some((word) => word.word === pair.word && word.translation === pair.translation));
            let incorrect;
            if (answerMode === "choice") {
              incorrect = session.index % 3 === 0 || session.index === session.total - 1;
              assert.equal(session.answer(-1), null);
              const choice = session.options.findIndex((option) => option.correct !== incorrect);
              session.answer(choice);
              assert.equal(session.answer(choice), null, "repeat clicks cannot duplicate review entries");
            } else {
              const pattern = session.index === session.total - 1 ? 1 : session.index % 4;
              incorrect = pattern === 1 || pattern === 2;
              assert.equal(session.answerTyped("...").empty, true);
              if (pattern === 2) {
                session.skip();
              } else {
                session.answerTyped("___wrong___");
                session.answerTyped("___wrong___");
                assert.deepEqual(session.incorrectWords, expected, "temporary retries are not scored mistakes");
                const result = session.answerTyped(incorrect ? "___wrong___" : answerFor(session));
                assert.equal(result.correct, !incorrect);
              }
              assert.equal(session.skip(), null);
              assert.equal(session.answerTyped(answerFor(session)), null);
            }
            if (incorrect) expected.push(pair);
            assert.deepEqual(session.incorrectWords, expected);
            assert.equal(session.incorrectWords.length, session.mistakes);
            assert.equal(session.advance(), true);
          }
          assert.ok(expected.length > 0);
          assert.equal(expected[expected.length - 1].word, session.order[session.total - 1].word,
            "the final mistake must survive completion");
          assert.equal(session.advance(), false);
          assert.deepEqual(session.incorrectWords, expected);
          const restarted = new Quiz.Session(words, distractors, seeded(902), mode, "express", answerMode, level, topic);
          assert.deepEqual(restarted.incorrectWords, []);
          assert.notEqual(restarted.incorrectWords, session.incorrectWords);
        }
      }
    });
  }
}

test("review keeps the selected topic meaning of a polysemous word", () => {
  for (const topic of ["time", "family"]) {
    for (const mode of Object.keys(Quiz.MODES)) {
      const session = new Quiz.Session(words, distractors, () => 0.999999, mode, "express", "typing", "1000", topic);
      const date = session.vocabulary.find((entry) => entry.word === "date");
      // Isolate one real, frequency-filtered question to exercise last-word review.
      session.order = [date];
      session.skip();
      session.advance();
      assert.deepEqual(session.incorrectWords, [{ word: "date", translation: topic === "time" ? "дата" : "свидание" }]);
      assert.equal(session.finished, true);
    }
  }
});

test("a new pass has its own mistakes while the completed pass keeps its result", () => {
  const first = new Quiz.Session(words, distractors, seeded(903), "en-ru", "full", "typing", "1000", "food");
  const entry = first.entry;
  first.skip();
  first.advance();
  first.answerTyped(answerFor(first));
  first.advance();
  assert.equal(first.correct, 1);
  assert.equal(first.mistakes, 1);
  const next = new Quiz.Session(words, distractors, seeded(904), "ru-en", "express", "typing", "3000", "family");
  assert.deepEqual(next.incorrectWords, []);
  next.skip();
  assert.deepEqual(first.incorrectWords, [{ word: entry.word, translation: entry.translation }]);
});
