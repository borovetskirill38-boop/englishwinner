import csv
import argparse
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

parser = argparse.ArgumentParser(description='Audit every quiz word against pinned local dictionary exports; do not modify quiz data.')
parser.add_argument('--reference-dir', required=True, type=Path, help='Directory containing the OpenRussian CSVs and WordNet adjective index listed in data/translation-reference.json')
parser.add_argument('--report', required=True, type=Path, help='Output JSON with proposals and source coverage')
args = parser.parse_args()
ROOT = Path(__file__).resolve().parents[1]
REFERENCE = args.reference_dir
metadata = json.loads((ROOT/'data/translation-reference.json').read_text())
for source in metadata.values():
    for filename, expected in source['files'].items():
        content = (REFERENCE/filename).read_bytes()
        if hashlib.sha256(content).hexdigest() != expected:
            raise ValueError('Reference snapshot does not match the pinned hash: ' + filename)

def normal(value):
    return re.sub(r'\s+', ' ', re.sub(r'\([^)]*\)', ' ', value)).strip().lower().replace('ё', 'е')

def forms(value):
    result = []
    for part in re.split(r'[,;/]', value or ''):
        part = part.replace("'", '').replace('\u0301', '').strip().lower()
        if re.fullmatch(r'[а-яё]+(?:[ -][а-яё]+)*', part):
            result.append(part)
    return result

def english(value):
    result = set()
    value = re.sub(r'\([^)]*\)', '', value.lower())
    for part in re.split(r'[,;]', value):
        part = re.sub(r'^to\s+', '', part.strip())
        if re.fullmatch(r'[a-z]+', part):
            result.add(part)
    return result

translations = {}
for line in (ROOT/'data/translations.tsv').read_text().splitlines():
    if line and not line.startswith('#'):
        word, text = line.split('\t')
        translations[word] = text.split('; ')
aliases = json.loads((ROOT/'data/answer-aliases.json').read_text())
accepted = {word: {meaning: {normal(meaning), *(normal(value) for value in aliases.get(word, {}).get(meaning, []))}
                   for meaning in meanings} for word, meanings in translations.items()}
all_accepted = {word: set().union(*senses.values()) for word, senses in accepted.items()}
catalogue = {}
reference_words = defaultdict(set)
for kind, file in [('noun', 'nouns.csv'), ('adjective', 'adjectives.csv'), ('verb', 'verbs.csv'), ('other', 'others.csv')]:
    with (REFERENCE/file).open() as stream:
        rows = list(csv.DictReader(stream, delimiter='\t'))
    catalogue[kind] = rows
    for row in rows:
        for word in english(row['translations_en']):
            reference_words[word].add(kind)

proposals = defaultdict(lambda: defaultdict(dict))
lexical = defaultdict(dict)
covered = set()

def propose(word, meaning, values, reason, lemma):
    for value in values:
        if normal(value) in all_accepted[word]:
            continue
        proposals[word][meaning].setdefault(value, {'reason': reason, 'russianLemma': lemma})

for kind, rows in catalogue.items():
    for index, row in enumerate(rows):
        for word in english(row['translations_en']) & translations.keys():
            covered.add(word)
            if index < 6000 and normal(row['bare']) not in all_accepted[word]:
                lexical[word].setdefault(row['bare'], {'kind': kind, 'rank': index + 1})

# Full nominative gender forms come from a real adjective paradigm. Short
# forms are expanded only when an existing accepted short form anchors them.
# This avoids conflating 'правый' (direction) and 'прав' (correct).
singular_only = {'this', 'that', 'one', 'each'}
plural_only = {'these', 'those'}
english_adjectives = {line.split()[0] for line in (REFERENCE/'wordnet-index.adj').read_text().splitlines()
                      if line and not line.startswith(' ')}
adj_rows = defaultdict(list)
for row in catalogue['adjective']:
    adj_rows[normal(row['bare'])].append(row)
    for value in forms(row['decl_m_nom']):
        if normal(value) != normal(row['bare']):
            adj_rows[normal(value)].append(row)
for word, senses in accepted.items():
    for meaning, values in senses.items():
        # A noun such as 'worker' must not gain the plural 'рабочие' merely
        # because Russian uses an adjective as a noun. Both languages are gated.
        if word not in english_adjectives or normal(meaning) not in adj_rows:
            continue
        for value in values:
            for row in adj_rows[value]:
                full_keys = ['decl_m_nom', 'decl_f_nom', 'decl_n_nom', 'decl_pl_nom']
                keys = full_keys[:3] if word in singular_only else (full_keys[3:] if word in plural_only else full_keys)
                if word == 'whole' and normal(row['bare']) == 'весь':
                    keys = full_keys[:3]
                full = sum((forms(row[key]) for key in keys), [])
                propose(word, meaning, full, 'adjective nominative gender/number', row['bare'])
                short = sum((forms(row[key]) for key in ['short_m', 'short_f', 'short_pl']), [])
                if normal(row['bare']) in values and any(normal(v) in values for v in short):
                    propose(word, meaning, short, 'anchored short adjective gender/number', row['bare'])

# Propagate already-vetted noun synonyms to an actual English plural. A real
# Russian plural already in that entry must first confirm the noun family.
irregular_plural = {'person': ['people', 'persons'], 'man': ['men'], 'woman': ['women'], 'child': ['children'],
    'tooth': ['teeth'], 'foot': ['feet'], 'mouse': ['mice'], 'goose': ['geese'],
    'gentleman': ['gentlemen'], 'wife': ['wives'], 'life': ['lives'], 'leaf': ['leaves'],
    'knife': ['knives'], 'shelf': ['shelves'], 'wolf': ['wolves'], 'thief': ['thieves'],
    'sheep': ['sheep'], 'deer': ['deer'], 'fish': ['fish'], 'species': ['species'],
    'series': ['series'], 'aircraft': ['aircraft']}
noun_rows = defaultdict(list)
for row in catalogue['noun']:
    for word in english(row['translations_en']):
        noun_rows[word].append(row)
for word, senses in accepted.items():
    if word in irregular_plural:
        plurals = irregular_plural[word]
    else:
        plurals = [word + 's', word + 'es']
        if re.search(r'[^aeiou]y$', word):
            plurals.append(word[:-1] + 'ies')
    for plural in plurals:
        if plural not in translations:
            continue
        rows = noun_rows[word]
        for meaning, values in senses.items():
            relevant = [row for row in rows if normal(row['bare']) in values or any(normal(v) in values for v in forms(row['sg_nom']))]
            target_senses = {target for row in relevant for target, existing in accepted[plural].items()
                             if any(normal(v) in existing for v in forms(row['pl_nom']))}
            if plural == word:
                target_senses.add(meaning)
            for target in target_senses:
                for row in relevant:
                    propose(plural, target, forms(row['pl_nom']), 'anchored noun plural family', row['bare'])
            if relevant:
                covered.add(plural)

# Past forms are expanded only around an already accepted finite past form,
# never by spelling similarity. 'saw' -> see cannot acquire forms of 'пить'.
past_lemmas = {
 'was':'be','were':'be','had':'have','did':'do','said':'say','told':'tell','went':'go',
 'came':'come','gave':'give','took':'take','got':'get','made':'make','saw':'see',
 'heard':'hear','felt':'feel','knew':'know','thought':'think','brought':'bring',
 'bought':'buy','sold':'sell','found':'find','won':'win','lost':'lose','left':'leave',
 'kept':'keep','held':'hold','met':'meet','sent':'send','spent':'spend','ran':'run',
 'sat':'sit','stood':'stand','slept':'sleep','ate':'eat','drank':'drink','wrote':'write',
 'spoke':'speak','broke':'break','fell':'fall','grew':'grow','became':'become',
 'began':'begin','chose':'choose','caught':'catch','taught':'teach','fought':'fight',
 'drove':'drive','flew':'fly','drew':'draw','threw':'throw','wore':'wear','swore':'swear',
 'stole':'steal','shook':'shake','laid':'lay','led':'lead','paid':'pay','rose':'rise',
 'sang':'sing','rang':'ring','hung':'hang','hid':'hide','blew':'blow','shot':'shoot',
 'struck':'strike','fled':'flee','fed':'feed','could':'can','meant':'mean','dealt':'deal',
 'put':'put','read':'read','cut':'cut','hit':'hit','set':'set','hurt':'hurt','let':'let',
}
verb_rows = defaultdict(list)
for row in catalogue['verb']:
    for word in english(row['translations_en']):
        verb_rows[word].append(row)
for word, senses in accepted.items():
    lemma = past_lemmas.get(word)
    if not lemma and word.endswith('ed'):
        candidates = ([word[:-3] + 'y'] if word.endswith('ied') else []) + [word[:-2], word[:-1]]
        if len(word) > 4 and word[-3] == word[-4]:
            candidates.append(word[:-3])
        lemma = next((candidate for candidate in candidates if candidate in verb_rows), None)
    if not lemma:
        continue
    for row in verb_rows[lemma]:
        keys = ['past_m', 'past_f', 'past_n'] + ([] if word == 'was' else ['past_pl'])
        past = sum((forms(row[key]) for key in keys), [])
        for meaning, values in senses.items():
            if any(normal(value) in values for value in past):
                propose(word, meaning, past, 'anchored past gender/number', row['bare'])
                covered.add(word)

report = {'scannedWords': len(translations), 'referenceCommit': metadata['openRussian']['commit'],
          'referenceCoveredWords': len(covered), 'formProposals': proposals, 'lexicalCandidates': lexical,
          'unmatchedWords': sorted(translations.keys() - covered)}
destination = args.report
destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'scannedWords': len(translations), 'referenceCoveredWords': len(covered),
    'wordsWithFormProposals': len(proposals), 'forms': sum(len(v) for senses in proposals.values() for v in senses.values()),
    'wordsWithLexicalCandidates': len(lexical), 'report': str(destination)}))
