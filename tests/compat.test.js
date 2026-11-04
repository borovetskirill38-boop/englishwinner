"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { loadData } = require("../scripts/build.js");
const { words, distractors } = loadData();

test("all settings and scoring work without Object.hasOwn or String.replaceAll", () => {
  const context = vm.createContext({ module: { exports: {} } });
  vm.runInContext("Object.hasOwn = undefined; String.prototype.replaceAll = undefined;", context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/quiz.js"), "utf8"), context);
  const Quiz = context.module.exports;
  for (const mode of ["en-ru", "ru-en"]) {
    for (const format of ["full", "express"]) {
      for (const answerMode of ["choice", "typing"]) {
        const session = new Quiz.Session(words, distractors, Math.random, mode, format, answerMode);
        assert.equal(session.total, format === "full" ? 3000 : 20);
        if (answerMode === "choice") {
          assert.equal(session.answer(session.options.findIndex((item) => item.correct)).correct, true);
        } else {
          assert.equal(session.answerTyped("___wrong___").retry, true);
          assert.equal(session.answered, 0);
          const answer = mode === "en-ru" ? Quiz.translationVariants(session.entry)[0] : session.entry.word;
          assert.equal(session.answerTyped(answer.toUpperCase()).correct, true);
        }
        assert.equal(session.correct, 1);
        assert.equal(session.advance(), true);
        if (answerMode === "typing") assert.equal(session.skip().skipped, true);
        else session.answer(session.options.findIndex((item) => !item.correct));
        assert.equal(session.mistakes, 1);
      }
    }
  }
});
