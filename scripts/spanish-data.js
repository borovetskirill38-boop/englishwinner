/* Spanish corpus and vocabulary retain their original build API. */
"use strict";
const { loadData, loadPhraseData } = require("./dictionary-data.js").createDataset({
  language: "es", directory: "spanish", wordPattern: /^[a-záéíóúüñ]+$/,
  singleLetters: "aeouy", label: "Испанский словарь",
});
module.exports = { loadSpanishData: loadData, loadSpanishPhraseData: loadPhraseData };
