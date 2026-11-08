"""Compare the shared page geometry so switching sections keeps the same layout."""
import json
import os
from pathlib import Path
import shutil

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = Path('/tmp/englishwinner-layout')
ARTIFACTS.mkdir(exist_ok=True)
SELECTORS = ['.header', '.brand', '.offline', '#intro', '#intro-title',
             '#intro > .hero-description', '.section-link', '.welcome-card',
             '.word-art', '.welcome-content', '.welcome-content h2', '.rules',
             'fieldset:has(input[name="mode"])', 'fieldset:has(input[name="format"])',
             '#start', '.intro-notes', '.footer']
WIDTHS = [320, 360, 390, 540, 600, 768, 1024, 1280, 1440]

with sync_playwright() as playwright:
    executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
    browser = playwright.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}))
    errors, requests = [], []
    for width in WIDTHS:
        context = browser.new_context(viewport={'width': width, 'height': 900}, offline=True)
        layouts = {}
        for name in ['index', 'phrases']:
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('http:', 'https:')) else None)
            page.set_content((ROOT / (name + '.html')).read_text(), wait_until='load')
            assert page.locator('#startup-warning').is_hidden()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (name, width)
            layouts[name] = page.evaluate('''selectors => Object.fromEntries(selectors.map(selector => {
              const element = document.querySelector(selector);
              if (!element) throw Error('Missing shared element: ' + selector);
              const r = element.getBoundingClientRect();
              return [selector, {x:r.x,y:r.y,width:r.width,height:r.height}];
            }))''', SELECTORS)
            if width in [390, 1280]:
                page.screenshot(path=str(ARTIFACTS / f'{name}-{width}.png'), full_page=True)
            page.close()
        for selector in SELECTORS:
            for dimension in ['x', 'y', 'width', 'height']:
                # Text itself differs, so its width can differ while its position stays fixed.
                if selector == '.offline' and dimension == 'width':
                    continue
                left, right = layouts['index'][selector][dimension], layouts['phrases'][selector][dimension]
                assert abs(left - right) <= 1, (width, selector, dimension, left, right)
        context.close()
    browser.close()
    assert not errors, errors
    assert not requests, requests
    print(json.dumps({'status': 'passed', 'engine': 'Chromium', 'widths': WIDTHS,
                      'sharedElements': len(SELECTORS), 'errors': errors, 'remoteRequests': requests}))
