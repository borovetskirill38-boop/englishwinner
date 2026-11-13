/* Build one portable HTML file using only the Node.js standard library. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const fail = (message) => { throw new Error(message); };
const WORD_COUNT = 5000;

function loadData() {
  const source = JSON.parse(read("data/source.json"));
  if (source.count !== WORD_COUNT) fail(`Источник должен содержать ${WORD_COUNT} слов`);
  const frequency = read("data/frequency-source.txt");
  const digest = crypto.createHash("sha256").update(frequency).digest("hex");
  if (digest !== source.excerptSha256) fail("Изменился исходный частотный список");
  const excluded = new Set(read("data/excluded.txt").split(/\s+/).filter(Boolean));
  const translations = new Map();
  const answerAliases = JSON.parse(read("data/answer-aliases.json"));
  for (const line of read("data/translations.tsv").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [word, translation, ...extra] = line.split("\t");
    if (!word || !translation || extra.length || translations.has(word)) {
      fail(`Некорректная или повторная строка перевода: ${word}`);
    }
    if (!/[а-яё]/i.test(translation)) fail(`Нет русского перевода: ${word}`);
    translations.set(word, translation);
  }
  const words = [];
  frequency.trimEnd().split("\n").forEach((line, index) => {
    const match = /^(\S+) (\d+)$/.exec(line);
    if (!match) fail(`Неверная строка частотности: ${index + 1}`);
    const [, word, count] = match;
    if (!/^[a-z]+$/.test(word) || (word.length === 1 && !["i", "a"].includes(word))
        || excluded.has(word) || words.length >= WORD_COUNT) return;
    if (!translations.has(word)) fail(`Нет перевода для ${word}`);
    words.push({ word, translation: translations.get(word), frequency: Number(count), rank: index + 1,
      ...(answerAliases[word] ? {
        aliases: [...new Set([].concat(...Object.values(answerAliases[word])))], meaningAliases: answerAliases[word],
      } : {}) });
  });
  if (words.length !== WORD_COUNT || translations.size !== WORD_COUNT) fail(`Должно быть ровно ${WORD_COUNT} слов`);
  if (new Set(words.map((w) => w.word)).size !== words.length) fail("Слова повторяются");
  for (const [word, senses] of Object.entries(answerAliases)) {
    const translation = translations.get(word);
    if (!translation || !senses || typeof senses !== "object" || Array.isArray(senses) || !Object.keys(senses).length) {
      fail(`Некорректные дополнительные переводы: ${word}`);
    }
    const meanings = translation.split(";").map((text) => text.trim());
    for (const [meaning, aliases] of Object.entries(senses)) {
      if (!meanings.includes(meaning) || !Array.isArray(aliases) || !aliases.length
          || new Set(aliases.map((text) => typeof text === "string" ? text.toLocaleLowerCase("ru").replace(/ё/g, "е") : text)).size !== aliases.length
          || aliases.some((alias) => typeof alias !== "string" || alias !== alias.trim() || !/[а-яё]/i.test(alias))) {
        fail(`Некорректные дополнительные переводы: ${word} / ${meaning}`);
      }
    }
  }
  const bank = JSON.parse(read("data/distractors.json"));
  const quiz = require("../src/quiz.js");
  const topicGroups = JSON.parse(read("data/topics.json"));
  const byWord = new Map(words.map((entry) => [entry.word, entry]));
  const seenTopics = new Set();
  for (const entry of words) entry.topics = [];
  for (const group of topicGroups) {
    if (group.id === "all" || !Object.prototype.hasOwnProperty.call(quiz.TOPICS, group.id)
        || seenTopics.has(group.id) || !Array.isArray(group.words) || !group.words.length) {
      fail(`Некорректная или повторная тема: ${group.id}`);
    }
    seenTopics.add(group.id);
    const seenWords = new Set();
    for (const word of group.words) {
      if (!byWord.has(word) || seenWords.has(word)) fail(`Неизвестное или повторное слово в теме ${group.id}: ${word}`);
      seenWords.add(word);
      byWord.get(word).topics.push(group.id);
    }
  }
  for (const id of Object.keys(quiz.TOPICS).filter((id) => id !== "all")) {
    if (!seenTopics.has(id)) fail(`Нет разметки для темы: ${id}`);
  }
  for (const entry of words) {
    if (!entry.topics.length) fail(`Слово не распределено по темам: ${entry.word}`);
  }
  const topicTranslations = JSON.parse(read("data/topic-translations.json"));
  for (const [word, overrides] of Object.entries(topicTranslations)) {
    const entry = byWord.get(word);
    if (!entry || !overrides || typeof overrides !== "object" || Array.isArray(overrides)) fail(`Некорректные значения по темам: ${word}`);
    const meanings = entry.translation.split(";").map((text) => text.trim());
    for (const [topic, selected] of Object.entries(overrides)) {
      if (!entry.topics.includes(topic) || !Array.isArray(selected) || !selected.length
          || new Set(selected).size !== selected.length || selected.some((text) => !meanings.includes(text))) {
        fail(`Некорректное тематическое значение: ${word} / ${topic}`);
      }
    }
    entry.topicTranslations = overrides;
  }
  for (const candidates of Object.values(bank)) {
    for (const candidate of candidates) {
      if (!candidate.text || !/^[a-z]+(?:[ -][a-z]+)*$/.test(candidate.english || "")) {
        fail(`Нужны русский и английский варианты: ${candidate.text}`);
      }
    }
  }
  for (const level of Object.keys(quiz.LEVELS)) {
    const vocabulary = quiz.wordsForLevel(words, level);
    const scopedBank = quiz.bankForVocabulary(vocabulary, bank);
    for (const mode of Object.keys(quiz.MODES)) {
      for (const word of vocabulary) quiz.optionsFor(word, scopedBank, Math.random, mode);
    }
  }
  return { words, distractors: bank, source };
}

function sharedTokens(phrases = false, language = "en") {
  let art = read("src/shared/welcome-art.html").trimEnd();
  if (phrases) {
    art = art.replace(">grow<", ">give up<").replace(">расти<", ">сдаваться<")
      .replace("НОВОЕ СЛОВО — НОВАЯ ВОЗМОЖНОСТЬ", "НОВЫЙ СМЫСЛ — НОВЫЕ ВОЗМОЖНОСТИ")
      .replace("<strong>5000</strong> слов для практики", "<strong>500 + 500</strong> для практики");
  }
  if (language === "es") {
    art = art.replace(phrases ? ">give up<" : ">grow<", phrases ? ">por fin<" : ">vivir<")
      .replace(phrases ? ">сдаваться<" : ">расти<", phrases ? ">наконец<" : ">жить<")
      .replace(">ENGLISH<", ">ESPAÑOL<").replace("✳", "✳︎");
  }
  if (language === "pt-BR") {
    art = art.replace(phrases ? ">give up<" : ">grow<", phrases ? ">pois é<" : ">viver<")
      .replace(phrases ? ">сдаваться<" : ">расти<", phrases ? ">именно так<" : ">жить<")
      .replace(">ENGLISH<", ">PORTUGUÊS · BR<").replace("✳", "✺");
  }
  const header = read("src/shared/header.html").trimEnd()
    .replace("{{EN_URL}}", phrases ? "./phrases.html" : "./index.html")
    .replace("{{ES_URL}}", phrases ? "./spanish-phrases.html" : "./spanish.html")
    .replace("{{PT_URL}}", phrases ? "./portuguese-phrases.html" : "./portuguese.html")
    .replace("{{EN_CURRENT}}", language === "en" ? 'aria-current="page"' : "")
    .replace("{{ES_CURRENT}}", language === "es" ? 'aria-current="page"' : "")
    .replace("{{PT_CURRENT}}", language === "pt-BR" ? 'aria-current="page"' : "");
  return {
    "{{ICONS}}": read("src/shared/icons.html").trimEnd(),
    "{{HEADER}}": header,
    "{{WELCOME_ART}}": art,
    "{{METRICS}}": read("src/shared/metrics.html").trimEnd(),
    "{{INTRO_NOTES}}": read("src/shared/intro-notes.html").trimEnd(),
  };
}

function localizedTemplate(template, language, phrases) {
  if (language === "en") return template;
  if (language === "pt-BR") return portugueseTemplate(template, phrases);
  if (language !== "es") fail(`Неизвестный язык: ${language}`);
  const page = phrases ? "spanish-phrases.html" : "spanish.html";
  const replacements = [
    ["en-ru", "es-ru"], ["ru-en", "ru-es"], [">EN<", ">ES<"],
    ["EN → RU", "ES → RU"], ["RU → EN", "RU → ES"], [">EN ", ">ES "], [" EN</strong>", " ES</strong>"],
    ["Английский", "Испанский"], ["английский", "испанский"],
    ["английских", "испанских"], ["английского", "испанского"],
    ["английском", "испанском"], ["английское", "испанское"], ["АНГЛИЙСКОГО", "ИСПАНСКОГО"],
    ["АНГЛИЙСКИЙ", "ИСПАНСКИЙ"], ["Фразовые глаголы", "Глагольные конструкции"],
    ["фразовые глаголы", "глагольные конструкции"], ["фразовых глаголов", "глагольных конструкций"],
    ["фразовые и предложные глаголы", "глагольные конструкции"],
    ['href="./index.html"', 'href="./spanish.html"'],
    ['href="./phrases.html"', 'href="./spanish-phrases.html"'],
    ['<body>', '<body class="spanish-page">'], ['<body class="phrases-page">', '<body class="phrases-page spanish-page">'],
    ['content="#f7f8f3"', 'content="#fff9ed"'],
    ['lang="en"', 'lang="es"'],
    ["500 глаголов · give up", "500 конструкций · darse cuenta"], ["500 выражений · a piece of cake", "500 выражений · pan comido"],
  ];
  let html = template;
  for (const [from, to] of replacements) html = html.replaceAll(from, to);
  html = html.replace("<title>", "<title>Испанский · ");
  html = html.replace(/https:\/\/borovetskirill38-boop\.github\.io\/englishwinner\/(?:phrases\.html)?/g,
    `https://borovetskirill38-boop.github.io/englishwinner/${page}`);
  const about = phrases
    ? '<p>Два отдельных испанских набора по 500 записей: устойчивые выражения и глагольные конструкции, включая словосочетания, перифразы и глаголы с управлением. Это учебная подборка распространённых употреблений, а не частотный рейтинг. У английских фразовых глаголов нет точного структурного аналога в испанском, поэтому здесь изучаются естественные испанские конструкции. Полный тест — 500 вопросов, экспресс — 20 случайных без повторов. В обоих направлениях только четыре варианта. После ошибки показаны оба перевода; в конце экспресса — список ошибок.</p>'
    : '<p>5000 испанских слов разговорного языка по корпусу OpenSubtitles (2018). Уровни — первые 1000, 3000 или 5000 слов выбранного частотного списка. Имена, шумовые токены и неподтверждённые словарём записи отфильтрованы; словоформы сохраняются. Это частота в субтитрах, а не универсальный рейтинг языка.</p><p>Сначала выбирается частотный уровень, затем тема. Вопросы, варианты и проверка испанских синонимов ограничены этим набором. Доступны ES → RU, RU → ES, полный и экспресс-тест, четыре варианта и ручной ввод. На слово три попытки; пустой ответ их не тратит. После третьей ошибки показывается перевод до явного перехода дальше. Правильный ручной ответ переходит автоматически, пропуск считается ошибкой. В конце экспресс-теста есть список ошибок.</p><p>При ручном вводе достаточно одного допустимого перевода. Регистр, пунктуация, пробелы и ё/е нормализуются. Испанские ударения и ñ сохраняются: si/sí, el/él и tu/tú — разные слова.</p>';
  const credits = '<p>Частотный источник: <a href="https://github.com/hermitdave/FrequencyWords/tree/525f9b560de45753a5ea01069454e72e9aa541c6/content/2018/es" target="_blank" rel="noopener noreferrer">FrequencyWords — Hermit Dave / OpenSubtitles</a>. Словарные сведения сверены с <a href="https://github.com/Vuizur/Wiktionary-Dictionaries/tree/be0cfb8d614470bc8b9d9006ddff8b921cd5c2e3" target="_blank" rel="noopener noreferrer">испанским Викисловарём — Wiktionary contributors / Vuizur</a> и <a href="https://github.com/Badestrand/russian-dictionary/tree/50e210c4803237779cb562bc1abcea529066031c" target="_blank" rel="noopener noreferrer">OpenRussian.org</a>. Словоформы сверены с Pattern / Fred F. Jehle. Подборки, переводы и тематическая разметка подготовлены для проекта. Данные и адаптации: <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>; код: MIT. <a href="https://github.com/borovetskirill38-boop/englishwinner" target="_blank" rel="noopener noreferrer">Источники, лицензии и изменения</a>.</p>';
  html = html.replace(/<details class="about">[\s\S]*?<\/details>/,
    `<details class="about"><summary>О словаре и правилах</summary><div class="about-content">${about}${credits}</div></details>`);
  return html;
}

function portugueseTemplate(template, phrases) {
  // Both Romance-language sections share the same Russian instructions and
  // layout. Only the study language, examples and source notes differ.
  let html = localizedTemplate(template, "es", phrases)
    .replace(/испанск/gi, (stem) => stem === stem.toUpperCase() ? "ПОРТУГАЛЬСК" : stem[0] === "И" ? "Португальск" : "португальск");
  const changes = [
    ["es-ru", "pt-BR-ru"], ["ru-es", "ru-pt-BR"], [">ES<", ">PT-BR<"],
    ["ES → RU", "PT-BR → RU"], ["RU → ES", "RU → PT-BR"], [">ES ", ">PT-BR "], [" ES</strong>", " PT-BR</strong>"],
    // Keep the two direction cards the same height at 320 px. The language
    // selector names Brazil explicitly; question badges retain PT-BR.
    ["<strong>PT-BR ", "<strong>PT "], [" PT-BR</strong>", " PT</strong>"],
    [">На португальский<", ">Португальский<"],
    ["spanish-phrases.html", "portuguese-phrases.html"], ["spanish.html", "portuguese.html"],
    ["spanish-page", "portuguese-page"], ['lang="es"', 'lang="pt-BR"'],
    ['content="#fff9ed"', 'content="#f7fbef"'],
    ["darse cuenta", "dar conta"], ["pan comido", "mamão com açúcar"],
    ["<title>Португальский ·", "<title>Португальский (Бразилия) ·"],
  ];
  for (const [from, to] of changes) html = html.replaceAll(from, to);
  const about = phrases
    ? '<p>Два отдельных учебных набора бразильского португальского: 500 устойчивых выражений и 500 глагольных конструкций, включая перифразы, глаголы с управлением и устойчивые сочетания. Это подборка распространённых употреблений, а не частотный рейтинг. Каждый набор можно пройти целиком или выбрать 20 случайных вопросов, в обоих направлениях. Здесь только четыре варианта ответа. После ошибки показаны оба перевода, в конце экспресса — список для повторения.</p>'
    : '<p>5000 слов бразильского португальского из отдельного корпуса FrequencyWords / OpenSubtitles (2018, pt_br). Уровни 1000, 3000 и 5000 — строгие частотные префиксы выбранного словаря после фильтрации отдельных имён, шума и неподтверждённых записей. Словоформы сохраняются. Это частотность субтитров, а не универсальный рейтинг языка.</p><p>Сначала выбирается уровень, затем тема. Вопросы, варианты и проверка синонимов ограничены этим набором. Доступны PT-BR → RU и RU → PT-BR, полный и экспресс-тест до 20 слов, четыре варианта или ручной ввод. На слово три попытки: первые две ошибки не меняют счёт, после третьей показывается правильный ответ до нажатия «Далее». Верный ввод переходит автоматически, пропуск считается ошибкой. В конце экспресса есть список ошибок.</p><p>Достаточно одного допустимого перевода. Регистр, пунктуация, лишние пробелы и ё/е нормализуются. Португальские диакритические знаки значимы: e/é, avó/avô и pais/país различаются.</p>';
  const credits = '<p>Частотный источник: <a href="https://github.com/hermitdave/FrequencyWords/tree/525f9b560de45753a5ea01069454e72e9aa541c6/content/2018/pt_br" target="_blank" rel="noopener noreferrer">FrequencyWords — Hermit Dave / OpenSubtitles</a>. Словарные сведения сверены с <a href="https://github.com/Vuizur/Wiktionary-Dictionaries/tree/be0cfb8d614470bc8b9d9006ddff8b921cd5c2e3" target="_blank" rel="noopener noreferrer">португальским Викисловарём — Wiktionary contributors / Vuizur</a>, OpenRussian и морфологическим справочником mlconjug3 / Ars-Linguistica. Переводы, темы и учебные подборки подготовлены для проекта. Данные и адаптации: <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>; код: MIT. Источники, версии и лицензии сохранены в репозитории.</p>';
  return html.replace(/<details class="about">[\s\S]*?<\/details>/,
    `<details class="about"><summary>О словаре и правилах</summary><div class="about-content">${about}${credits}</div></details>`);
}

function dataFor(language, phrases = false) {
  if (language === "es") return require("./spanish-data.js")[phrases ? "loadSpanishPhraseData" : "loadSpanishData"]();
  if (language === "pt-BR") return require("./portuguese-data.js")[phrases ? "loadPortuguesePhraseData" : "loadPortugueseData"]();
  if (language !== "en") fail(`Неизвестный язык: ${language}`);
  return phrases ? loadPhraseData() : loadData();
}

function languageStyles(language) {
  return language === "es" ? "\n" + read("src/spanish.css") : language === "pt-BR" ? "\n" + read("src/portuguese.css") : "";
}

function build(language = "en") {
  const data = dataFor(language);
  const template = localizedTemplate(read("src/index.template.html"), language, false);
  const tokens = {
    ...sharedTokens(false, language),
    "{{STYLES}}": read("src/styles.css") + languageStyles(language),
    "{{DATA}}": JSON.stringify(data).replaceAll("<", "\\u003c"),
    "{{SCRIPT}}": `const LEARNING_LANGUAGE = "${language}";\n` + read("src/quiz.js") + "\n" + read("src/app.js"),
  };
  let html = template;
  for (const [token, value] of Object.entries(tokens)) {
    if (html.split(token).length !== 2) fail(`В шаблоне должен быть один маркер ${token}`);
    html = html.replace(token, () => value);
  }
  return html;
}

function loadPhraseData() {
  const files = {
    expressions: ["expressions-conversation.tsv", "expressions-idioms.tsv"],
    "phrasal-verbs": ["phrasal-verbs-a-l.tsv", "phrasal-verbs-m-z.tsv"],
  };
  const data = {};
  const key = (text) => text.toLocaleLowerCase("en").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  for (const [collection, sources] of Object.entries(files)) {
    data[collection] = [];
    const seen = new Set();
    for (const source of sources) {
      const entries = read(`data/${source}`).split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
      if (entries.length !== 250) fail(`${source}: должно быть ровно 250 записей`);
      for (const line of entries) {
        const [english, translation, ...extra] = line.split("\t");
        if (!english || !translation || extra.length || english !== english.trim() || translation !== translation.trim()
            || !/^[a-z]/i.test(english) || !english.includes(" ") || !/[а-яё]/i.test(translation) || seen.has(key(english))) {
          fail(`Некорректное или повторное выражение ${collection}: ${english}`);
        }
        seen.add(key(english));
        data[collection].push({ english, translation });
      }
    }
    if (data[collection].length !== 500) fail(`${collection}: должно быть ровно 500 записей`);
  }
  data.exclusions = JSON.parse(read("data/phrase-confusions.json"));
  if (Object.keys(data.exclusions).some((collection) => !Object.prototype.hasOwnProperty.call(files, collection))) fail("Неизвестный набор исключений выражений");
  for (const collection of Object.keys(files)) {
    const known = new Set(data[collection].map((entry) => entry.english));
    const groups = data.exclusions[collection];
    if (!Array.isArray(groups)) fail(`Нет групп синонимов для ${collection}`);
    for (const group of groups) {
      if (!Array.isArray(group) || group.length < 2 || new Set(group).size !== group.length || group.some((english) => !known.has(english))) {
        fail(`Некорректная группа близких выражений: ${JSON.stringify(group)}`);
      }
    }
  }
  return data;
}

function buildPhrases(language = "en") {
  const tokens = {
    ...sharedTokens(true, language),
    "{{STYLES}}": read("src/styles.css") + "\n" + read("src/phrases.css") + languageStyles(language),
    "{{DATA}}": JSON.stringify(dataFor(language, true)).replaceAll("<", "\\u003c"),
    "{{SCRIPT}}": `const LEARNING_LANGUAGE = "${language}";\n` + read("src/phrase-core.js") + "\n" + read("src/phrase-app.js"),
  };
  let html = localizedTemplate(read("src/phrases.template.html"), language, true);
  for (const [token, value] of Object.entries(tokens)) {
    if (html.split(token).length !== 2) fail(`В шаблоне выражений должен быть один маркер ${token}`);
    html = html.replace(token, () => value);
  }
  return html;
}

if (require.main === module) {
  const pages = { "index.html": build(), "phrases.html": buildPhrases(),
    "spanish.html": build("es"), "spanish-phrases.html": buildPhrases("es"),
    "portuguese.html": build("pt-BR"), "portuguese-phrases.html": buildPhrases("pt-BR") };
  for (const [name, html] of Object.entries(pages)) {
    if (process.argv.includes("--check")) {
      if (read(name) !== html) fail(`${name} устарел. Выполните npm run build`);
    } else {
      fs.writeFileSync(path.join(root, name), html);
    }
    console.log(`${name}: ${Buffer.byteLength(html)} байт, ${process.argv.includes("--check") ? "актуален" : "собран"}.`);
  }
}

module.exports = { build, loadData, buildPhrases, loadPhraseData };
