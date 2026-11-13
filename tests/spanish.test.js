"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Quiz = require("../src/quiz.js").forLanguage("es");
const PhraseQuiz = require("../src/phrase-core.js").forLanguage("es");
const { loadSpanishData, loadSpanishPhraseData } = require("../scripts/spanish-data.js");
const { words, distractors, source } = loadSpanishData();
const phrases = loadSpanishPhraseData();
const byWord = new Map(words.map(entry => [entry.word, entry]));
const read = name => fs.readFileSync(path.join(__dirname, "../data/spanish", name), "utf8");
function seeded(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
const typed = s => s.mode === Quiz.FORWARD ? Quiz.translationVariants(s.entry)[0] : s.entry.word;

test("Spanish words follow their independent pinned corpus, including original ranks and frequencies", () => {
  const raw = read("frequency-source.txt");
  assert.equal(crypto.createHash("sha256").update(raw).digest("hex"), source.excerptSha256);
  const excluded = new Set(read("excluded.txt").trim().split(/\s+/));
  const expected = raw.trim().split("\n").map((line, index) => {
    const [word, frequency] = line.split(" "); return {word, frequency:Number(frequency), rank:index + 1};
  }).filter(e => /^[a-záéíóúüñ]+$/.test(e.word) && (e.word.length > 1 || "aeouy".includes(e.word)) && !excluded.has(e.word)).slice(0, 5000);
  assert.equal(words.length, 5000);
  assert.deepEqual(words.map(({word, frequency, rank}) => ({word, frequency, rank})), expected);
  assert.deepEqual(words.slice(0, 5).map(e => e.word), ["de", "que", "no", "a", "la"]);
  assert.ok(!byWord.has("the") && !byWord.has("house") && !byWord.has("bob"));
  for (const e of words) {
    assert.ok(e.topics.length, e.word);
    assert.ok(!/[a-z_]/i.test(e.translation), e.word);
    for (const answer of Quiz.translationVariants(e)) assert.equal(Quiz.matchesAnswer(e, "es-ru", answer), true, `${e.word}: ${answer}`);
    assert.equal(Quiz.matchesAnswer(e, "ru-es", e.word), true);
  }
});

test("reviewed Spanish meanings, gender, number and accents have independent regression examples", () => {
  for (const [word, expected] of Object.entries({ madre:["мать","мама"], hermana:["сестра"], hermanas:["сёстры"], apellido:["фамилия"], mayo:["май"], uñas:["ногти","когти"], tarjeta:["карта","карточка"], prueba:["доказательство"], señoras:["дамы"], café:["кофе"], policía:["полиция"] })) {
    for (const translation of expected) assert.ok(Quiz.matchesAnswer(byWord.get(word), "es-ru", translation), `${word}/${translation}`);
  }
  for (const [word, wrong] of [["madre","отец"],["hermanas","братья"],["mayo","мочь"],["uñas","гвозди"],["apellido","деятельность"]]) assert.equal(Quiz.matchesAnswer(byWord.get(word), "es-ru", wrong), false, word);
  for (const [word, wrong] of [["sí","si"],["él","el"],["tú","tu"],["niño","nino"],["año","ano"]]) {
    assert.equal(Quiz.matchesAnswer(byWord.get(word), "ru-es", wrong), false, word);
    assert.equal(Quiz.matchesAnswer(byWord.get(word), "ru-es", `¡${word.toUpperCase()}!`), true, word);
  }
  assert.equal(Quiz.normalizeAnswer("  ¿QUÉ?  "), "qué");
  assert.notEqual(Quiz.normalizeAnswer("año"), Quiz.normalizeAnswer("ano"));
});

for (const level of Object.keys(Quiz.LEVELS)) {
  test(`Spanish ${level}: every topic and every choice stays inside the frequency prefix`, () => {
    const prefix = words.slice(0, Number(level));
    const prefixSet = new Set(prefix.map(e => e.word));
    assert.deepEqual(Quiz.wordsForLevel(words.slice().reverse(), level), prefix);
    for (const topic of Object.keys(Quiz.TOPICS)) {
      const vocabulary = Quiz.wordsForTopic(prefix, topic);
      assert.ok(vocabulary.length, `${level}/${topic}`);
      assert.equal(vocabulary.length, topic === "all" ? prefix.length : prefix.filter(e => e.topics.includes(topic)).length);
      const allowed = new Map(vocabulary.map(e => [e.word, e]));
      const bank = Quiz.bankForVocabulary(vocabulary, distractors, topic !== "all");
      const answerIndex = Quiz.buildEnglishIndex(vocabulary);
      for (const entry of vocabulary) {
        assert.ok(prefixSet.has(entry.word));
        for (const answer of Quiz.translationVariants(entry)) assert.ok(Quiz.matchesAnswer(entry, "es-ru", answer));
        for (const mode of Object.keys(Quiz.MODES)) {
          const options = Quiz.optionsFor(entry, bank, seeded(entry.rank), mode);
          assert.equal(options.length, 4);
          assert.equal(options.filter(o => o.correct).length, 1);
          assert.equal(new Set(options.map(o => Quiz.normalizeAnswer(o.text))).size, 4);
          for (const option of options) {
            assert.ok(allowed.has(option.word), `${level}/${topic}: ${option.word}`);
            if (!option.correct) assert.equal(Quiz.matchesAnswer(entry, mode, option.text, answerIndex), false,
              `${entry.word} has another valid choice ${option.word} in ${level}/${topic}/${mode}`);
          }
        }
      }
    }
  });
  test(`Spanish ${level}: all topics, directions, formats and answer modes preserve attempts and scores`, () => {
    for (const topic of Object.keys(Quiz.TOPICS)) for (const mode of Object.keys(Quiz.MODES)) for (const format of Object.keys(Quiz.FORMATS)) for (const answerMode of Object.keys(Quiz.ANSWER_MODES)) {
      const s = new Quiz.Session(words, distractors, seeded(93), mode, format, answerMode, level, topic);
      assert.equal(s.total, format === "express" ? Math.min(20,s.vocabularySize) : s.vocabularySize);
      assert.equal(new Set(s.order.map(e=>e.word)).size,s.total);
      assert.ok(s.order.every(e=>words.indexOf(byWord.get(e.word)) < Number(level)));
      const first = s.entry;
      if (answerMode === "typing") {
        assert.equal(s.answerTyped(" ").empty,true);
        assert.equal(s.attemptsLeft,3);
        for (let i=0;i<2;i++) {assert.equal(s.answerTyped("___неверно___").retry,true);assert.equal(s.answered,0);assert.equal(s.advance(),false);}
        assert.equal(s.answerTyped(typed(s)).correct,true);
      } else {
        assert.equal(s.advance(),false);
        assert.equal(s.answer(s.options.findIndex(o=>o.correct)).correct,true);
      }
      assert.equal(s.correct,1); assert.equal(s.answered,1); assert.equal(s.entry,first);
      assert.equal(s.advance(),true);
      assert.equal(s.selected,null);
      if (answerMode === "typing") {
        assert.equal(s.attemptsLeft,3);
        for (let i=0;i<2;i++) s.answerTyped("___неверно___");
        const failure=s.answerTyped("___неверно___");
        assert.equal(failure.exhausted,true);assert.equal(s.selected,"exhausted");assert.equal(s.answerTyped(typed(s)),null);
      } else s.answer(s.options.findIndex(o=>!o.correct));
      assert.equal(s.correct,1);assert.equal(s.mistakes,1);assert.equal(s.incorrectWords.length,1);
      s.advance();
      if (answerMode === "typing") {assert.equal(s.skip().skipped,true);assert.equal(s.mistakes,2);s.advance();}
      const restart=new Quiz.Session(words,distractors,seeded(94),mode,format,answerMode,level,topic);
      assert.notDeepEqual(restart.order.map(e=>e.word),s.order.map(e=>e.word));
      assert.equal(restart.correct,0);assert.equal(restart.answered,0);
    }
  });
}

test("Spanish topic senses and typed synonyms cannot leak from a different topic or prefix", () => {
  const b=Quiz.wordsForTopic(words,"home").find(e=>e.word==="banco");
  assert.ok(Quiz.matchesAnswer(b,"es-ru","скамейка"));
  assert.equal(Quiz.matchesAnswer(b,"es-ru","банк"),false);
  const v=Quiz.wordsForTopic(words,"food").find(e=>e.word==="vino");
  assert.ok(Quiz.matchesAnswer(v,"es-ru","вино"));
  assert.equal(Quiz.matchesAnswer(v,"es-ru","пришёл"),false);
  const source=byWord.get("sobre");
  const spatial=Quiz.wordsForTopic([source],"space")[0];
  assert.equal(Quiz.matchesAnswer(spatial,"es-ru","конверт"),false);
  let found=false;
  const prefix=words.slice(0,1000), index=Quiz.buildEnglishIndex(prefix);
  for(const e of prefix){
    const outside=words.slice(1000).find(other=>other.translation.split("; ").includes(Quiz.primaryTranslation(e)));
    if(outside){assert.equal(Quiz.matchesAnswer(e,"ru-es",outside.word,index),false);found=true;break;}
  }
  assert.ok(found,"real out-of-level synonym regression fixture");
});

for(const collection of Object.keys(PhraseQuiz.COLLECTIONS)) {
  test(`Spanish ${collection}: all 500 entries have four unambiguous collection-bound options in both directions`,()=>{
    assert.equal(phrases[collection].length,500);
    const byPhrase=new Map(phrases[collection].map(e=>[e.english,e]));
    for(const mode of Object.keys(PhraseQuiz.MODES)) {
      const s=new PhraseQuiz.Session(phrases,collection,mode,"full",seeded(741));
      const seen=new Set();
      while(!s.finished) {
        assert.ok(!seen.has(s.entry.english));seen.add(s.entry.english);
        assert.equal(s.options.length,4);assert.equal(s.options.filter(o=>o.correct).length,1);
        assert.equal(new Set(s.options.map(o=>PhraseQuiz.normalize(o.text))).size,4);
        const family=s.exclusions.get(PhraseQuiz.normalize(s.entry.english));
        for(const option of s.options){assert.ok(byPhrase.has(option.english));if(!option.correct && family)assert.ok(!family.has(PhraseQuiz.normalize(option.english)));}
        const correct=s.index%3!==0, selected=s.options.findIndex(o=>o.correct===correct);
        assert.equal(s.advance(),false);assert.equal(s.answer(selected).correct,correct);assert.equal(s.answer(selected),null);s.advance();
      }
      assert.equal(seen.size,500);assert.equal(s.answered,500);assert.equal(s.mistakes,167);assert.equal(s.correct,333);
      const express=new PhraseQuiz.Session(phrases,collection,mode,"express",seeded(742));
      assert.equal(express.total,20);assert.equal(new Set(express.order.map(e=>e.english)).size,20);
      assert.ok(express.order.every(e=>byPhrase.has(e.english)));
    }
  });
}

test("independent native phrase and construction examples remain translated correctly",()=>{
  const find=(collection,key)=>phrases[collection].find(e=>e.english===key).translation;
  assert.equal(find("expressions","pan comido"),"проще простого");
  assert.equal(find("expressions","por si acaso"),"на всякий случай");
  assert.equal(find("phrasal-verbs","darse cuenta de"),"осознавать; замечать");
  assert.equal(find("phrasal-verbs","echar de menos"),"скучать по; ощущать нехватку");
  assert.equal(find("phrasal-verbs","acabar de hacer algo"),"только что что-либо сделать");
  assert.equal(find("phrasal-verbs","tener que ver con"),"иметь отношение к");
});
