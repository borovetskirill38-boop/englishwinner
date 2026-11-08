"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const PhraseQuiz = require("../src/phrase-core.js");
const loadData = () => require("../scripts/build.js").loadPhraseData();

function seeded(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

function fixture() {
  return { expressions: Array.from({ length: 500 }, (_, i) => ({ english: `fixture phrase ${i}`, translation: `Значение ${i}` })) };
}

function familyFor(groups, english) {
  const family = new Set([PhraseQuiz.normalize(english)]);
  let previous = -1;
  while (previous !== family.size) {
    previous = family.size;
    for (const group of groups) {
      if (group.some((phrase) => family.has(PhraseQuiz.normalize(phrase)))) {
        for (const phrase of group) family.add(PhraseQuiz.normalize(phrase));
      }
    }
  }
  return family;
}

test("phrase data contains exactly 500 distinct expressions and 500 distinct phrasal verbs", () => {
  const data = loadData();
  for (const collection of Object.keys(PhraseQuiz.COLLECTIONS)) {
    assert.equal(data[collection].length, 500);
    assert.equal(new Set(data[collection].map((entry) => PhraseQuiz.normalize(entry.english))).size, 500);
    for (const entry of data[collection]) {
      assert.match(entry.english, /[a-z]+[ -][a-z]+/i);
      assert.match(entry.translation, /[а-яё]/i);
      assert.equal(entry.english, entry.english.trim());
      assert.equal(entry.translation, entry.translation.trim());
    }
  }
});

for (const collection of Object.keys(PhraseQuiz.COLLECTIONS)) {
  for (const mode of Object.keys(PhraseQuiz.MODES)) {
    for (const format of Object.keys(PhraseQuiz.FORMATS)) {
      test(`${collection}, ${mode}, ${format}: complete runs stay within the selected collection and reset safely`, () => {
        const data = loadData();
        const original = JSON.stringify(data);
        const random = seeded(4578);
        const session = new PhraseQuiz.Session(data, collection, mode, format, random);
        const total = format === "full" ? 500 : 20;
        const expected = new Map(data[collection].map((entry) => [entry.english, entry.translation]));
        assert.equal(session.total, total);
        assert.equal(session.accuracy, 0);
        assert.equal(new Set(session.order.map((entry) => entry.english)).size, total);
        const wrongEntries = [];
        for (let index = 0; index < total; index += 1) {
          const entry = session.entry;
          assert.equal(expected.get(entry.english), entry.translation);
          assert.equal(session.prompt, mode === "en-ru" ? entry.english : entry.translation);
          assert.equal(session.advance(), false);
          assert.equal(session.options.length, 4);
          assert.equal(new Set(session.options.map((option) => PhraseQuiz.normalize(option.text))).size, 4);
          assert.equal(session.options.filter((option) => option.correct).length, 1);
          const family = familyFor(data.exclusions && data.exclusions[collection] || [], entry.english);
          for (const option of session.options) {
            assert.equal(expected.get(option.english), option.translation, "distractor imported from another collection");
            assert.equal(option.text, mode === "en-ru" ? option.translation : option.english);
            if (!option.correct) {
              assert.notEqual(PhraseQuiz.normalize(option.translation), PhraseQuiz.normalize(entry.translation));
              assert.ok(!family.has(PhraseQuiz.normalize(option.english)), "synonymous expression offered as a wrong answer");
            }
          }
          for (const invalid of [-1, 4, 1.5, NaN, "0", null]) assert.equal(session.answer(invalid), null);
          const correct = index % 2 === 0;
          const optionIndex = session.options.findIndex((option) => option.correct === correct);
          const selected = session.options[optionIndex];
          const result = session.answer(optionIndex);
          assert.deepEqual(result, { correct, english: entry.english, translation: entry.translation, selected });
          assert.equal(session.answer(optionIndex), null);
          assert.equal(session.answer((optionIndex + 1) % 4), null);
          assert.equal(session.index, index, "must wait for the explicit next action");
          if (!correct) wrongEntries.push(entry);
          assert.equal(session.advance(), true);
        }
        assert.equal(session.finished, true);
        assert.equal(session.correct, total / 2);
        assert.equal(session.mistakes, total / 2);
        assert.equal(session.accuracy, 50);
        assert.deepEqual(session.incorrectEntries, wrongEntries);
        assert.equal(session.prompt, "");
        assert.deepEqual(session.options, []);
        assert.equal(session.answer(0), null);
        assert.equal(session.advance(), false);
        const next = new PhraseQuiz.Session(data, collection, mode, format, random);
        assert.equal(next.correct, 0);
        assert.equal(next.mistakes, 0);
        assert.deepEqual(next.incorrectEntries, []);
        assert.notDeepEqual(next.order, session.order);
        assert.equal(JSON.stringify(data), original, "runs must not mutate the dictionary");
      });
    }
  }
}

test("express runs sample across the whole selected set and always contain 20 unique entries", () => {
  const data = fixture();
  const random = seeded(413);
  const seen = new Set();
  const samples = new Set();
  for (let pass = 0; pass < 25; pass += 1) {
    const session = new PhraseQuiz.Session(data, "expressions", "en-ru", "express", random);
    assert.equal(session.order.length, 20);
    assert.equal(new Set(session.order.map((entry) => entry.english)).size, 20);
    samples.add(session.order.map((entry) => entry.english).join("|"));
    for (const entry of session.order) seen.add(entry.english);
  }
  assert.equal(samples.size, 25);
  assert.ok(seen.size > 250);
  assert.ok([...seen].some((value) => Number(value.split(" ").pop()) >= 490));
});

test("Russian synonyms, punctuation, ё and explanatory notes do not create multiple correct choices", () => {
  const entry = { english: "be on a roll", translation: "быть на подъёме; переживать полосу удач" };
  const vocabulary = [entry,
    { english: "be on a winning streak", translation: "Переживать полосу удач!" },
    { english: "be in full swing", translation: "быть на подъеме (о делах)" },
    { english: "break the ice", translation: "разрядить обстановку" },
    { english: "hit the road", translation: "отправиться в путь" },
    { english: "keep an eye on", translation: "присматривать за" },
  ];
  for (const mode of Object.keys(PhraseQuiz.MODES)) {
    for (let seed = 0; seed < 10; seed += 1) {
      const options = PhraseQuiz.optionsFor(entry, vocabulary, seeded(seed), mode);
      assert.equal(options.length, 4);
      assert.equal(options.filter((option) => option.correct).length, 1);
      assert.ok(!options.some((option) => ["be on a winning streak", "be in full swing"].includes(option.english)));
    }
    assert.throws(() => PhraseQuiz.optionsFor(entry, vocabulary.slice(0, 3), seeded(3), mode), /Недостаточно/);
  }
});

test("invalid selections and malformed collections are rejected before starting", () => {
  const data = fixture();
  for (const value of ["other", "toString", "constructor", "__proto__", ""]) {
    assert.throws(() => new PhraseQuiz.Session(data, value), /Неизвестный набор/);
    assert.throws(() => new PhraseQuiz.Session(data, "expressions", value), /Неизвестное направление/);
    assert.throws(() => new PhraseQuiz.Session(data, "expressions", "en-ru", value), /Неизвестный формат/);
  }
  for (const vocabulary of [undefined, [], data.expressions.slice(0, 499)]) {
    assert.throws(() => new PhraseQuiz.Session({ expressions: vocabulary }), /500/);
  }
  const duplicated = fixture();
  duplicated.expressions[499] = duplicated.expressions[0];
  assert.throws(() => new PhraseQuiz.Session(duplicated), /повторяющиеся/);
  const empty = fixture();
  empty.expressions[0].translation = " ";
  assert.throws(() => new PhraseQuiz.Session(empty), /пустая/);
});

test("overlapping semantic families exclude equivalent phrases transitively in both directions", () => {
  const data = fixture();
  data.expressions.splice(0, 3,
    { english: "hold on", translation: "подожди" },
    { english: "hang on", translation: "погоди" },
    { english: "wait a second", translation: "подожди секунду" });
  data.exclusions = { expressions: [["hold on", "hang on"], ["hang on", "wait a second"]] };
  for (const mode of Object.keys(PhraseQuiz.MODES)) {
    const session = new PhraseQuiz.Session(data, "expressions", mode, "full", seeded(37));
    while (!session.finished) {
      if (["hold on", "hang on", "wait a second"].includes(session.entry.english)) {
        const equivalents = session.options.filter((option) => ["hold on", "hang on", "wait a second"].includes(option.english));
        assert.equal(equivalents.length, 1);
        assert.equal(equivalents[0].correct, true);
      }
      session.answer(0);
      session.advance();
    }
  }
});

test("phrase core runs without modern Object.hasOwn and String.replaceAll APIs", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/phrase-core.js"), "utf8");
  const context = vm.createContext({});
  vm.runInContext("Object.hasOwn = undefined; String.prototype.replaceAll = undefined;", context);
  vm.runInContext(source + "\nglobalThis.subject = PhraseQuiz;", context);
  const session = new context.subject.Session(fixture(), "expressions", "en-ru", "express", seeded(19));
  const index = session.options.findIndex((option) => option.correct);
  assert.equal(session.answer(index).correct, true);
  assert.equal(session.advance(), true);
});

test("both pages link to each other and the phrases HTML is current and self-contained", () => {
  const { build, buildPhrases } = require("../scripts/build.js");
  const html = buildPhrases();
  assert.equal(html, fs.readFileSync(path.join(__dirname, "../phrases.html"), "utf8"));
  assert.ok(html.startsWith("<!doctype html>"));
  assert.match(build(), /href=["'](?:\.\/)?phrases\.html["']/);
  assert.match(html, /href=["'](?:\.\/)?index\.html["']/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+(?:stylesheet|preload)|@import|fetch\(/i);
  assert.doesNotMatch(html, /id=["']typed-form["']|name=["']answer-mode["']/);
  const data = JSON.parse(/<script id="phrase-data" type="application\/json">(.*?)<\/script>/s.exec(html)[1]);
  assert.equal(data.expressions.length, 500);
  assert.equal(data["phrasal-verbs"].length, 500);
  assert.deepEqual(data, loadData());
});
