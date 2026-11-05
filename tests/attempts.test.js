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

function correctAnswer(session) {
  return session.mode === "ru-en" ? session.entry.word : Quiz.translationVariants(session.entry)[0];
}

for (const level of Object.keys(Quiz.LEVELS)) {
  for (const topic of Object.keys(Quiz.TOPICS)) {
    for (const mode of Object.keys(Quiz.MODES)) {
      for (const format of Object.keys(Quiz.FORMATS)) {
        test(`${level}, ${topic}, ${mode}, ${format}: three attempts, one mistake and explicit advance`, () => {
          const session = new Quiz.Session(words, distractors, seeded(213), mode, format, "typing", level, topic);
          assert.equal(Quiz.MAX_TYPING_ATTEMPTS, 3);
          assert.equal(session.attemptsUsed, 0);
          assert.equal(session.attemptsLeft, 3);
          for (const empty of ["", "   ", "...", null]) {
            assert.equal(session.answerTyped(empty).empty, true);
            assert.equal(session.attemptsLeft, 3);
            assert.equal(session.answered, 0);
          }
          const first = session.entry;
          for (let attempt = 1; attempt <= 2; attempt += 1) {
            const result = session.answerTyped("___wrong___");
            assert.equal(result.retry, true);
            assert.equal(result.attemptsLeft, 3 - attempt);
            assert.equal(session.entry, first);
            assert.equal(session.index, 0);
            assert.equal(session.answered, 0);
            assert.equal(session.selected, null);
            assert.equal(session.advance(), false);
          }
          assert.equal(session.answerTyped(" ").empty, true);
          assert.equal(session.attemptsLeft, 1);
          assert.equal(session.answerTyped(correctAnswer(session)).correct, true);
          assert.equal(session.attemptsUsed, 3);
          assert.equal(session.correct, 1);
          assert.equal(session.mistakes, 0);
          assert.equal(session.answerTyped("___wrong___"), null);
          assert.equal(session.skip(), null);
          assert.equal(session.advance(), true);
          assert.equal(session.attemptsLeft, 3);

          const second = session.entry;
          session.answerTyped("___wrong___");
          session.answerTyped("___wrong___");
          const exhausted = session.answerTyped("___wrong___");
          assert.equal(exhausted.exhausted, true);
          assert.equal(exhausted.correct, false);
          assert.equal(exhausted.attemptsLeft, 0);
          assert.equal(exhausted.word, second.word);
          assert.equal(exhausted.translation, second.translation);
          assert.equal(session.entry, second);
          assert.equal(session.index, 1, "reveal must leave the word on screen until explicit advance");
          assert.equal(session.selected, "exhausted");
          assert.equal(session.answered, 2);
          assert.equal(session.correct, 1);
          assert.equal(session.mistakes, 1);
          assert.equal(session.answerTyped(correctAnswer(session)), null);
          assert.equal(session.answerTyped("___wrong___"), null);
          assert.equal(session.answerTyped(""), null);
          assert.equal(session.skip(), null);
          assert.equal(session.attemptsUsed, 3);
          assert.equal(session.mistakes, 1);
          assert.equal(session.advance(), true);
          assert.equal(session.attemptsUsed, 0);
          assert.equal(session.attemptsLeft, 3);

          session.answerTyped("___wrong___");
          assert.equal(session.skip().skipped, true);
          assert.equal(session.mistakes, 2);
          assert.equal(session.skip(), null);
          session.advance();
          assert.equal(session.attemptsLeft, 3);
          assert.equal(session.skip().skipped, true);
          assert.equal(session.mistakes, 3);
          session.advance();
          assert.equal(session.attemptsLeft, 3);
          const restart = new Quiz.Session(words, distractors, seeded(2), mode, format, "typing", level, topic);
          assert.equal(restart.attemptsUsed, 0);
          assert.equal(restart.correct, 0);
          assert.equal(restart.mistakes, 0);
        });
      }
    }
  }
}

test("an exhausted final word does not finish or score again until the explicit next action", () => {
  const pool = words.map((entry, index) => Object.assign({}, entry, { topics: index === 0 ? ["home"] : [] }));
  for (const mode of Object.keys(Quiz.MODES)) {
    for (const format of Object.keys(Quiz.FORMATS)) {
      const session = new Quiz.Session(pool, distractors, Math.random, mode, format, "typing", "1000", "home");
      for (let attempt = 0; attempt < 3; attempt += 1) session.answerTyped("___wrong___");
      assert.equal(session.total, 1);
      assert.equal(session.finished, false);
      assert.equal(session.index, 0);
      assert.equal(session.answered, 1);
      assert.equal(session.mistakes, 1);
      assert.equal(session.answerTyped(correctAnswer(session)), null);
      assert.equal(session.advance(), true);
      assert.equal(session.finished, true);
      assert.equal(session.advance(), false);
      assert.equal(session.answerTyped("___wrong___"), null);
      assert.equal(session.skip(), null);
      assert.equal(session.mistakes, 1);
    }
  }
});

test("correct first and second attempts still score once and reset the next word", () => {
  const session = new Quiz.Session(words, distractors, seeded(413), "en-ru", "express", "typing");
  assert.equal(session.answerTyped(correctAnswer(session)).correct, true);
  assert.equal(session.attemptsUsed, 1);
  session.advance();
  session.answerTyped("___wrong___");
  assert.equal(session.answerTyped(correctAnswer(session)).correct, true);
  assert.equal(session.attemptsUsed, 2);
  assert.equal(session.correct, 2);
  assert.equal(session.mistakes, 0);
  session.advance();
  assert.equal(session.attemptsLeft, 3);
});
