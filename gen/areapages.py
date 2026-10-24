#!/usr/bin/env python3
"""Generate static, SEO-friendly landing pages per pilot area from site/kitchens.html.
Run from anywhere: python3 gen/areapages.py <site-dir>. Add or edit areas in AREAS, run again, and the sitemap is updated."""
import re, sys, os
site = sys.argv[1]
AREAS = [  # slug, display name, area id used by the ordering page, nearby places for the copy
  ('syokimau', 'Syokimau', 'syokimau', 'Syokimau, Mlolongo and along Mombasa Road'),
  ('umoja', 'Umoja', 'umoja-1', 'Umoja 1, Umoja 2, Innercore and Tena'),
  ('buruburu', 'Buruburu', 'buruburu-phase-1', 'Buruburu Phases 1 to 5 and Eastlands'),
  ('utawala', 'Utawala', 'utawala', 'Utawala and along the Eastern Bypass'),
]
base = open(os.path.join(site, 'kitchens.html'), encoding='utf-8').read()
sm_path = os.path.join(site, 'sitemap.xml'); sm = open(sm_path, encoding='utf-8').read()
for slug, name, aid, near in AREAS:
    fn = 'kitchens-%s.html' % slug; url = 'https://www.azizobutchery.co.ke/' + fn
    h = base
    h = re.sub(r'<title>.*?</title>', '<title>Homemade Lunch &amp; Dinner Delivery in %s, Nairobi | Azizo Kitchens</title>' % name, h, count=1)
    h = re.sub(r'(<meta name="description" content=")[^"]*', r'\g<1>Order homemade Kenyan lunch and dinner in %s: pilau, ugali and stew, githeri, mukimo and family packs from vetted home kitchens near you. Pre-order, delivered hot.' % name, h, count=1)
    h = h.replace('https://www.azizobutchery.co.ke/kitchens.html', url)
    h = re.sub(r'(<meta property="og:title" content=")[^"]*', r'\g<1>Homemade Lunch & Dinner in %s | Azizo Kitchens' % name, h, count=1)
    h = h.replace('<h1>Real Kenyan food, <em>cooked near you</em></h1>', '<h1>Homemade Kenyan food in <em>%s</em></h1>' % name)
    h = h.replace('Lunch and dinner made fresh in vetted home kitchens in your own estate. Pre-order, and it arrives hot.', 'Lunch and dinner made fresh in vetted home kitchens serving %s. Pre-order, and it arrives hot.' % near)
    h = h.replace('<script src="kk-config.js"></script>', '<script>window.KK_AREA="%s";</script>\n<script src="kk-config.js"></script>' % aid, 1)
    open(os.path.join(site, fn), 'w', encoding='utf-8').write(h)
    entry = '  <url><loc>%s</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>\n' % url
    if url not in sm: sm = sm.replace('</urlset>', entry + '</urlset>')
open(sm_path, 'w', encoding='utf-8').write(sm)
print('wrote', len(AREAS), 'area pages')
