"""Spanish vocabulary topic matrix, attempt/review flows, and all four navigation routes."""
import json
import os
from pathlib import Path
import shutil
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://englishwinner.test/'
ARTIFACTS = Path('/tmp/englishwinner-spanish-browser')
ARTIFACTS.mkdir(exist_ok=True)
HOOK = r'''() => {
  const Original = Quiz.Session;
  Quiz.Session = class extends Original {
    constructor(...args) { super(...args); window.testSession = this; }
  };
  const el = id => document.getElementById(id);
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const data = JSON.parse(el('vocabulary-data').textContent);
  const select = (name,value) => document.querySelector(`input[name="${name}"][value="${value}"]`).click();
  const type = answer => { el('typed-answer').value=answer; el('check-answer').click(); };
  const answer = () => testSession.mode === Quiz.FORWARD ? Quiz.translationVariants(testSession.entry)[0] : testSession.entry.word;
  const inspect = () => {
    const s=testSession, reverse=s.mode===Quiz.REVERSE;
    check(el('word').textContent===s.prompt,'Wrong prompt');
    check(el('word').lang===(reverse?'ru':'es'),'Wrong prompt language');
    check(el('direction-from').textContent===(reverse?'RU':'ES'),'Wrong direction from');
    check(el('direction-to').textContent===(reverse?'ES':'RU'),'Wrong direction to');
    check(el('training-topic').textContent===Quiz.TOPICS[s.topic],'Wrong topic');
    const prefix=new Set(data.words.slice(0,Number(s.level)).map(e=>e.word));
    check(s.order.every(e=>prefix.has(e.word) && (s.topic==='all'||e.topics.includes(s.topic))),'Out-of-level/topic question');
    if(s.answerMode==='choice') {
      check(el('options').children.length===4,'Four options missing');
      const pool=new Set(s.vocabulary.map(e=>e.word));
      check(s.options.every(o=>pool.has(o.word)),'Out-of-scope option');
      check(s.options.filter(o=>o.correct).length===1,'Ambiguous correctness');
      check([...el('options').querySelectorAll('.option-text')].every(e=>e.lang===(reverse?'es':'ru')),'Wrong option language');
    }
    else check(el('typed-answer').lang===(reverse?'es':'ru'),'Wrong typing language');
    check(document.documentElement.scrollWidth<=innerWidth,'Horizontal overflow');
  };
  window.testTopicBatch = ({level,topic}) => {
    let configurations=0,completed=0;
    for(const mode of ['es-ru','ru-es'])for(const format of ['express','full'])for(const method of ['choice','typing']) {
      for(const [name,value] of [['level',level],['mode',mode],['format',format],['answer-mode',method]])select(name,value);
      el('topic').value=topic; el('topic').dispatchEvent(new Event('change',{bubbles:true}));
      check(el('start').disabled===false,'Start disabled');el('start').click();
      const s=testSession;inspect();
      check(s.total===(format==='express'?Math.min(20,s.vocabularySize):s.vocabularySize),'Wrong total');
      check(Number(el('total-count').textContent)===s.total,'Wrong total label');
      if(method==='choice') {
        const wrong=s.options.findIndex(o=>!o.correct), option=s.options[wrong];
        el('options').children[wrong].click();
        check(el('options').children[wrong].classList.contains('wrong'),'Wrong option is not red');
        check(el('options').querySelector('.correct'),'Right option is not green');
        const chosen=s.vocabulary.find(e=>e.word===option.word);
        check(!el('feedback-selected').hidden && el('feedback-selected').textContent.includes(chosen.word),'Selected word translation absent');
        check(el('feedback-detail').textContent.includes(s.entry.word),'Correct translation absent');
        check(s.index===0 && s.mistakes===1,'Wrong scoring or automatic advance');
        el('next').click();inspect();
        el('options').children[s.options.findIndex(o=>o.correct)].click();
        check(s.correct===1,'Correct answer not counted');el('next').click();
      } else {
        const first=s.entry;
        type('');check(s.attemptsLeft===3,'Empty answer consumed attempt');
        for(let i=0;i<3;i++) {
          type('___ошибка___');
          check(s.entry===first && s.index===0,'Wrong typed answer advanced');
          check(s.attemptsLeft===2-i,'Wrong attempts counter');
          check(el('typed-answer').classList.contains('is-wrong'),'Wrong typed answer not red');
          check(el('typed-answer').getAttribute('aria-invalid')==='true','Missing invalid state');
        }
        check(s.answered===1 && s.mistakes===1,'Three attempts must count one mistake');
        check(el('feedback-detail').textContent.includes(mode==='es-ru'?first.translation:first.word),'No answer after third failure');
        check(!el('next').disabled,'Explicit next missing after reveal');
        el('next').click();check(s.index===1 && s.attemptsLeft===3,'Next did not reset attempts');
        type(answer());check(s.index===2 && s.correct===1,'Correct typing did not advance');
        check(!el('typed-outcome').hidden && el('typed-outcome').textContent.startsWith('Верно:'),'Correct typing feedback missing');
        // A touch click can report detail=2 even after a different control.
        el('skip-word').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));
        check(s.index===3 && s.mistakes===2,'First skip after Check was suppressed');
        el('skip-word').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:3}));
        check(s.index===3 && s.mistakes===2,'Double skip counted the next word');
      }
      if(format==='express') {
        while(!s.finished){if(method==='typing')type(answer());else{el('options').children[s.options.findIndex(o=>o.correct)].click();el('next').click();}}
        check(!el('complete').hidden,'Completion missing');
        check(Number(el('result-mistakes').textContent)===(method==='choice'?1:2),'Wrong result score');
        check(!el('mistake-review').hidden,'Express mistake review missing');
        check(el('mistake-review-list').children.length===s.mistakes,'Wrong review count');
        for(let i=0;i<s.incorrectWords.length;i++) {
          const row=el('mistake-review-list').children[i],entry=s.incorrectWords[i];
          check(row.children[0].textContent===(mode==='es-ru'?entry.word:Quiz.primaryTranslation(entry)),'Wrong review source');
          check(row.children[1].textContent===(mode==='es-ru'?entry.translation:entry.word),'Wrong review answer');
        }
        check(el('mistake-review-source-heading').textContent===(mode==='es-ru'?'Испанский':'Русский'),'Wrong review heading');
        completed+=s.total;
        const old=s.order.map(e=>e.word).join('|');el('restart-complete').click();
        check(testSession.answered===0 && testSession.correct===0,'Restart did not reset');
        check(testSession.order.map(e=>e.word).join('|')!==old,'Restart did not reshuffle');
      }
      el('change-mode').click();check(!el('intro').hidden,'Mode switch failed');configurations++;
    }
    return {configurations,completed};
  };
}'''

with sync_playwright() as playwright:
    executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
    browser = playwright.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}))
    errors, requests = [], []
    configurations = completed = 0
    for legacy in [False, True]:
        context = browser.new_context(viewport={'width':390,'height':844},has_touch=True,is_mobile=True,offline=True)
        if legacy:
            context.add_init_script('Object.hasOwn=undefined;String.prototype.replaceAll=undefined;Element.prototype.replaceChildren=undefined;Element.prototype.replaceWith=undefined;')
        def serve(route):
            name=urlparse(route.request.url).path.rsplit('/',1)[-1]
            if route.request.url.startswith(BASE) and name in ['index.html','phrases.html','spanish.html','spanish-phrases.html']:
                route.fulfill(status=200,content_type='text/html; charset=utf-8',body=(ROOT/name).read_text())
            elif name=='favicon.ico':route.fulfill(status=204,body='')
            else:requests.append(route.request.url);route.abort()
        context.route('**/*',serve)
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        # Real links preserve section type when changing language.
        for source,target,label in [('index.html','spanish.html','ES'),('spanish.html','index.html','EN'),('phrases.html','spanish-phrases.html','ES'),('spanish-phrases.html','phrases.html','EN')]:
            page.goto(BASE+source)
            assert page.locator('#startup-warning').is_hidden()
            assert page.locator('.language-switch a[aria-current=page]').inner_text()==('ES' if source.startswith('spanish') else 'EN')
            page.locator('.language-switch').get_by_role('link',name=label,exact=True).tap()
            page.wait_for_url(BASE+target)
            assert page.locator('#start').is_enabled()
        page.goto(BASE+'spanish.html');page.evaluate(HOOK)
        assert page.locator('.paper-label').inner_text()=='ESPAÑOL'
        assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")=='#aa2638'
        topics=page.locator('#topic option').evaluate_all('(options)=>options.map(e=>e.value)')
        assert len(topics)==22
        for level in ['1000','3000','5000']:
            for topic in topics:
                r=page.evaluate('testTopicBatch',{'level':level,'topic':topic})
                configurations+=r['configurations'];completed+=r['completed']
            print(f'Spanish {level}: all topics and eight mode combinations passed; legacy={legacy}',flush=True)
        page.screenshot(path=str(ARTIFACTS/f'intro-legacy-{legacy}.png'),full_page=True)
        context.close()
    browser.close()
    assert not errors,errors
    assert not requests,requests
    print(json.dumps({'status':'passed','engine':'Chromium','topicConfigurations':configurations,'completedExpressQuestions':completed,'errors':errors,'remoteRequests':requests}))
