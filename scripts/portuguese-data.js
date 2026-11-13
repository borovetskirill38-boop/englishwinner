/* Brazilian Portuguese uses its own corpus, vocabulary and phrase collections. */
"use strict";
const { loadData, loadPhraseData } = require("./dictionary-data.js").createDataset({
  language: "pt-BR", directory: "portuguese", wordPattern: /^[a-záàâãéêíóôõúüç]+(?:-[a-záàâãéêíóôõúüç]+)*$/,
  singleLetters: "aeoéàó", label: "Бразильский португальский словарь",
});
module.exports = { loadPortugueseData: loadData, loadPortuguesePhraseData: loadPhraseData };
