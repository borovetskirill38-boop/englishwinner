"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Quiz = require("../src/quiz.js").forLanguage("pt-BR");
const PhraseQuiz = require("../src/phrase-core.js").forLanguage("pt-BR");
const { loadPortugueseData, loadPortuguesePhraseData } = require("../scripts/portuguese-data.js");
const { words, distractors, source } = loadPortugueseData();
const phrases = loadPortuguesePhraseData();
const byWord = new Map(words.map(entry => [entry.word, entry]));
const read = name => fs.readFileSync(path.join(__dirname, "../data/portuguese", name), "utf8");
function seeded(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
const typed = s => s.mode === Quiz.FORWARD ? Quiz.translationVariants(s.entry)[0] : s.entry.word;

test("Portuguese words follow their independent pinned corpus, including original ranks and frequencies", () => {
  const raw = read("frequency-source.txt");
  assert.equal(crypto.createHash("sha256").update(raw).digest("hex"), source.excerptSha256);
  const excluded = new Set(read("excluded.txt").trim().split(/\s+/));
  const expected = raw.trim().split("\n").map((line, index) => {
    const [word, frequency] = line.split(" "); return {word, frequency:Number(frequency), rank:index + 1};
  }).filter(e => /^[a-záàâãéêíóôõúüç]+(?:-[a-záàâãéêíóôõúüç]+)*$/.test(e.word) && (e.word.length > 1 || "aeoéàó".includes(e.word)) && !excluded.has(e.word)).slice(0, 5000);
  assert.equal(words.length, 5000);
  assert.deepEqual(words.map(({word, frequency, rank}) => ({word, frequency, rank})), expected);
  assert.deepEqual(words.slice(0, 5).map(e => e.word), ["que", "não", "o", "de", "a"]);
  assert.ok(!byWord.has("the") && !byWord.has("house") && !byWord.has("bob"));
  for (const e of words) {
    assert.ok(e.topics.length, e.word);
    assert.ok(!/[a-z_]/i.test(e.translation), e.word);
    for (const answer of Quiz.translationVariants(e)) assert.equal(Quiz.matchesAnswer(e, "pt-BR-ru", answer), true, `${e.word}: ${answer}`);
    assert.equal(Quiz.matchesAnswer(e, "ru-pt-BR", e.word), true);
  }
});

test("Brazilian usage, gender, number and false friends have independent examples", () => {
  const examples = {
    mãe:["мать","мама"], pai:["отец","папа"], irmã:["сестра"], irmãs:["сёстры"], filhas:["дочери"],
    celular:["мобильный телефон","сотовый телефон"], time:["команда"], trem:["поезд"],
    apelido:["прозвище","кличка"], sobrenome:["фамилия"], oficina:["мастерская"], sucesso:["успех"],
    ferramentas:["инструменты"], unhas:["ногти","когти"], amarelo:["жёлтый"], maio:["май"],
    refrigerante:["газировка"], cartão:["карта","карточка"], prova:["доказательство","подтверждение","улика"],
    falar:["говорить","разговаривать","сказать"], ir:["идти","ехать","ходить","поехать"],
    avó:["бабушка"], avô:["дедушка"]
  };
  for (const [word, meanings] of Object.entries(examples)) for (const meaning of meanings) {
    assert.ok(byWord.has(word), word);
    assert.ok(Quiz.matchesAnswer(byWord.get(word), Quiz.FORWARD, meaning), `${word}/${meaning}`);
  }
  for (const [word, wrong] of [["mãe","отец"],["irmãs","братья"],["filhas","сыновья"],["unhas","гвозди"],
    ["apelido","фамилия"],["sobrenome","прозвище"],["oficina","офис"],["sucesso","событие"],
    ["celular","клетчатый"],["ferramentas","пенисы"],["amarelo","вынужденный"],
    ["refrigerante","хлопок"],["costume","костюм"],["gravar","спасать"]]) {
    assert.equal(Quiz.matchesAnswer(byWord.get(word), Quiz.FORWARD, wrong), false, `${word}/${wrong}`);
  }
});

test("Portuguese accents remain meaningful while case, punctuation and Unicode composition normalize", () => {
  for (const [word, wrong] of [["é","e"],["pôr","por"],["está","esta"],["país","pais"],
    ["avó","avô"],["pôde","pode"],["têm","tem"],["coração","coracao"],["não","nao"]]) {
    assert.ok(byWord.has(word), word);
    assert.equal(Quiz.matchesAnswer(byWord.get(word), Quiz.REVERSE, wrong), false, word);
    assert.equal(Quiz.matchesAnswer(byWord.get(word), Quiz.REVERSE, `«${word.toUpperCase()}!»`), true, word);
  }
  assert.equal(Quiz.normalizeAnswer("  NÃO!  "), "não");
  assert.equal(Quiz.normalizeAnswer("na\u0303o"), "não");
  assert.notEqual(Quiz.normalizeAnswer("avó"), Quiz.normalizeAnswer("avô"));
});

for (const level of Object.keys(Quiz.LEVELS)) {
  test(`Portuguese ${level}: every topic and every choice stays inside the frequency prefix`, () => {
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
        for (const answer of Quiz.translationVariants(entry)) assert.ok(Quiz.matchesAnswer(entry, "pt-BR-ru", answer));
        for (const mode of Object.keys(Quiz.MODES)) {
          const options = Quiz.optionsFor(entry, bank, seeded(entry.rank), mode);
          assert.equal(options.length, 4);
          assert.equal(options.filter(o => o.correct).length, 1);
          assert.equal(new Set(options.map(o => Quiz.normalizeAnswer(o.text))).size, 4);
          for (const option of options) {
            assert.ok(allowed.has(option.word), `${level}/${topic}: ${option.word}`);
            if (!option.correct) {
              assert.equal(Quiz.matchesAnswer(entry, mode, option.text, answerIndex), false,
                `${entry.word} has another valid choice ${option.word} in ${level}/${topic}/${mode}`);
              if (entry.choiceFamily) assert.notEqual(allowed.get(option.word).choiceFamily, entry.choiceFamily,
                `${entry.word}/${option.word} are forms of the same verb`);
            }
          }
        }
      }
    }
  });
  test(`Portuguese ${level}: all topics, directions, formats and answer modes preserve attempts and scores`, () => {
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

test("Portuguese topic senses and typed synonyms cannot leak from a different topic or prefix", () => {
  const inTopic = (word, topic) => Quiz.wordsForTopic(words, topic).find(e => e.word === word);
  for (const [word, topic, correct, wrong] of [
    ["banco","home","скамейка","банк"],
    ["prova","food","проба","доказательство"],
    ["prova","food","проба","улика"],
    ["prova","law","доказательство","экзамен"],
    ["carta","communication","письмо","игральная карта"],
    ["vela","home","свеча","парус"],
    ["pasta","food","паста","папка"]
  ]) {
    const entry = inTopic(word, topic);
    assert.ok(entry, `${word}/${topic}`);
    assert.ok(Quiz.matchesAnswer(entry, Quiz.FORWARD, correct), `${word}/${topic}/${correct}`);
    assert.equal(Quiz.matchesAnswer(entry, Quiz.FORWARD, wrong), false, `${word}/${topic}/${wrong}`);
  }
  assert.ok(Quiz.matchesAnswer(inTopic("prova","law"), Quiz.FORWARD, "улика"));
  const prefix = Quiz.wordsForLevel(words, "1000");
  const basicIndex = Quiz.buildEnglishIndex(prefix), allIndex = Quiz.buildEnglishIndex(words);
  assert.ok(prefix.some(e => e.word === "você") && prefix.some(e => e.word === "tu"));
  assert.ok(!prefix.some(e => e.word === "vc"));
  assert.ok(Quiz.matchesAnswer(byWord.get("você"), Quiz.REVERSE, "tu", basicIndex));
  assert.equal(Quiz.matchesAnswer(byWord.get("você"), Quiz.REVERSE, "vc", basicIndex), false);
  assert.ok(Quiz.matchesAnswer(byWord.get("você"), Quiz.REVERSE, "vc", allIndex));
});

for(const collection of Object.keys(PhraseQuiz.COLLECTIONS)) {
  test(`Portuguese ${collection}: all 500 entries have four unambiguous collection-bound options in both directions`,()=>{
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

test("native Brazilian expressions and verb constructions retain their meanings", () => {
  const find=(collection,key)=>phrases[collection].find(e=>e.english===key).translation;
  assert.equal(find("expressions","mamão com açúcar"),"проще простого");
  assert.equal(find("expressions","por via das dúvidas"),"на всякий случай");
  assert.equal(find("expressions","pois é"),"именно так; да уж");
  assert.equal(find("phrasal-verbs","se dar conta de"),"осознавать; замечать");
  assert.equal(find("phrasal-verbs","dar conta de"),"справляться с");
  assert.equal(find("phrasal-verbs","acabar de fazer algo"),"только что что-либо сделать");
  assert.equal(find("phrasal-verbs","fazer uma vaquinha"),"собирать деньги в складчину");
  assert.equal(find("phrasal-verbs","tirar de letra"),"справиться без труда");
});
