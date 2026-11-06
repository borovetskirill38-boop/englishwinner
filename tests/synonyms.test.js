"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Quiz = require("../src/quiz.js");
const { loadData } = require("../scripts/build.js");
const { words, distractors } = loadData();

// Independent examples of correct translations, including reported failures and
// meanings that must be excluded from the selected topic.
const cases = [
  ["all", "lady", ["дама", "леди"], ["дамы", "лед"]],
  ["all", "ladies", ["дамы", "леди"], ["дама", "лед"]],
  ["people", "ladies", ["леди", "дамы"], ["дама"]],
  ["all", "doctor", ["врач", "доктор"], ["доктора"]],
  ["all", "doctors", ["врачи", "доктора"], ["доктор"]],
  ["all", "doc", ["доктор", "врач", "медик"], ["врачи"]],
  ["all", "friends", ["друзья", "подруги"], ["подруга"]],
  ["all", "cousin", ["кузен", "кузина"], ["сосед"]],
  ["all", "white", ["белый", "белая", "белое", "белые"], ["российский"]],
  ["all", "dozen", ["дюжина"], ["десяток", "десять"]],
  ["all", "this", ["этот", "эта", "это"], ["эти"]],
  ["all", "he", ["он"], ["она"]],
  ["all", "was", ["был", "была", "было"], ["были"]],
  ["all", "saw", ["видел", "видела", "видели"], ["пил"]],
  ["all", "prisoner", ["заключённый", "заключённая"], ["заключённые"]],
  ["all", "scientist", ["учёный", "учёная"], ["учёные"]],
  ["space", "right", ["правый", "правая", "правое"], ["верная"]],
  ["space", "left", ["левый", "левая"], ["ушёл", "ушла"]],
  ["health", "patient", ["пациент", "больной"], ["терпеливая", "терпеливый"]],
  ["all", "card", ["карта", "карточка", "открытка"], ["картинка", "кар"]],
  ["education", "card", ["карта", "карточка"], ["открытка"]],
  ["family", "card", ["открытка", "поздравительная открытка"], ["карта"]],
  ["all", "proof", ["доказательство", "подтверждение"], ["опровержение"]],
  ["law", "proof", ["доказательство", "свидетельство"], ["сомнение"]],
  ["law", "evidence", ["доказательство", "доказательства", "улика", "улики"], ["догадка"]],
  ["nature", "bank", ["берег", "берег реки"], ["банк"]],
  ["work", "bank", ["банк"], ["берег"]],
  ["work", "book", ["бронировать", "забронировать", "резервировать"], ["книга", "книжка"]],
  ["time", "watch", ["часы", "наручные часы"], ["наблюдать"]],
  ["communication", "watch", ["наблюдать", "посмотреть"], ["часы"]],
  ["qualities", "right", ["верный", "правильный"], ["правый", "право"]],
  ["law", "will", ["завещание"], ["буду", "воля"]],
  ["food", "can", ["банка", "консервная банка"], ["уметь", "мочь"]],
  ["law", "fine", ["штраф", "денежное взыскание"], ["прекрасный"]],
  ["food", "date", ["финик"], ["дата", "свидание"]],
  ["law", "private", ["рядовой"], ["частный"]],
  ["time", "may", ["май"], ["мочь"]],
  ["technology", "drive", ["диск", "привод"], ["ехать"]],
  ["nature", "spring", ["родник", "источник"], ["весна", "пружина"]],
  ["work", "check", ["чек", "банковский чек"], ["проверять"]],
];

for (const level of Object.keys(Quiz.LEVELS)) {
  test(`${level}: independent Russian synonyms and sense boundaries are respected`, () => {
    const vocabulary = Quiz.wordsForLevel(words, level);
    for (const [topic, word, accepted, rejected] of cases) {
      if (!vocabulary.some((entry) => entry.word === word)) continue;
      const scoped = Quiz.wordsForTopic(vocabulary, topic);
      const entry = scoped.find((item) => item.word === word);
      assert.ok(entry, `${word} / ${topic}`);
      for (const answer of accepted) assert.equal(Quiz.matchesAnswer(entry, "en-ru", answer), true, `${word} / ${topic}: ${answer}`);
      for (const answer of rejected) assert.equal(Quiz.matchesAnswer(entry, "en-ru", answer), false, `${word} / ${topic}: ${answer}`);
      for (const format of Object.keys(Quiz.FORMATS)) {
        let remaining = scoped.length;
        const target = scoped.findIndex((item) => item.word === word);
        const random = () => { remaining -= 1; return remaining === target ? 0 : 1 - Number.EPSILON; };
        const session = new Quiz.Session(words, distractors, random, "en-ru", format, "typing", level, topic);
        assert.equal(session.entry.word, word);
        const result = session.answerTyped(accepted[accepted.length - 1].toUpperCase());
        assert.equal(result.correct, true);
        assert.equal(session.correct, 1);
        assert.equal(session.mistakes, 0);
        assert.equal(session.attemptsLeft, 2);
      }
    }
  });

  test(`${level}: all declared translations work in every topic; unrelated sense aliases do not leak`, () => {
    const vocabulary = Quiz.wordsForLevel(words, level);
    for (const topic of Object.keys(Quiz.TOPICS)) {
      const scoped = Quiz.wordsForTopic(vocabulary, topic);
      const index = Quiz.buildEnglishIndex(scoped);
      for (const entry of scoped) {
        const declared = new Set(Quiz.translationVariants(entry).map(Quiz.normalizeAnswer));
        for (const answer of Quiz.translationVariants(entry)) {
          assert.equal(Quiz.matchesAnswer(entry, "en-ru", answer), true, `${topic}, ${entry.word}: ${answer}`);
        }
        assert.equal(Quiz.matchesAnswer(entry, "ru-en", entry.word, index), true);
        const selected = new Set(entry.translation.split(";").map((value) => value.trim()));
        for (const meaning of Object.keys(entry.meaningAliases || {})) {
          if (selected.has(meaning)) continue;
          for (const answer of entry.meaningAliases[meaning]) {
            if (declared.has(Quiz.normalizeAnswer(answer))) continue;
            assert.equal(Quiz.matchesAnswer(entry, "en-ru", answer), false, `${topic}, ${entry.word}: leaked ${answer}`);
          }
        }
      }
    }
  });
}

test("English synonyms still obey the selected level and topic", () => {
  for (const level of Object.keys(Quiz.LEVELS)) {
    const scoped = Quiz.wordsForTopic(Quiz.wordsForLevel(words, level), "law");
    const index = Quiz.buildEnglishIndex(scoped);
    const evidence = scoped.find((entry) => entry.word === "evidence");
    assert.equal(Quiz.matchesAnswer(evidence, "ru-en", "proof", index), level !== "1000");
    const food = Quiz.wordsForTopic(Quiz.wordsForLevel(words, level), "food");
    const can = food.find((entry) => entry.word === "can");
    assert.equal(Quiz.matchesAnswer(can, "ru-en", "can", Quiz.buildEnglishIndex(food)), true);
    assert.equal(Quiz.matchesAnswer(can, "ru-en", "may", Quiz.buildEnglishIndex(food)), false);
  }
});
