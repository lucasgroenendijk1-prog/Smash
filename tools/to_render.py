"""Zet de Claude-versie van SMASH. om naar de Render-versie (Supabase, SEO)."""
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()

def once(old, new):
    global s
    n = s.count(old)
    if n != 1:
        sys.exit(f'FOUT: {n}x gevonden: {old[:80]!r}')
    s = s.replace(old, new)

# 1. SEO-kop
once('<!doctype html><html><head><meta charset=utf8>',
 '<!doctype html><html lang="nl"><head><meta charset=utf8>'
 '<title>SMASH. – Padel app: tegenstander zoeken, ranglijst & baan huren</title>'
 '<meta name="description" content="SMASH. is de gratis padel-app voor Nederland: vind tegenstanders op jouw niveau, plan potjes met vrienden, houd je ranglijst bij en ontdek 110 padelclubs.">'
 '<link rel="canonical" href="https://smash-qoos.onrender.com/">'
 '<meta property="og:type" content="website">'
 '<meta property="og:title" content="SMASH. – Padel app">'
 '<meta property="og:description" content="Vind tegenstanders, plan potjes en houd je ranglijst bij. Gratis padel-app voor Nederland.">'
 '<meta property="og:url" content="https://smash-qoos.onrender.com/">'
 '<meta property="og:locale" content="nl_NL">'
 '<meta name="theme-color" content="#0e8e86">')
import re
s, n = re.subn(r'\n<title>[^<]*</title>\n', '\n', s, count=1)
if n != 1: sys.exit('FOUT: oude <title> niet gevonden')

# 2. Database-scripts vóór het app-script
once('</div>\n\n<script>\n(function () {',
 '</div>\n\n<!-- Losse website (Render): database via Supabase. Binnen Claude doet db.js niets. -->\n'
 '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>\n'
 '<script src="config.js"></script>\n<script src="db.js"></script>\n\n<script>\n(function () {')

# 3. Claude-only sessie-sync uitzetten (buiten Claude geen gedeelde "mijn sessie")
once("if (!S.userCap || typeof S.userCap.id !== 'function') return null;",
     "if (!S.userCap || typeof S.userCap.id !== 'function' || window.SMASH_STANDALONE) return null;")

# 4. Duidelijke melding als de database niet bereikbaar is
old = "'<p class=\"muted\">Deze weergave kan de gedeelde database niet bereiken. Open de gepubliceerde pagina rechtstreeks (niet in een voorbeeldvenster) en probeer opnieuw.</p></div></main>';"
once(old, "(window.SMASH_STANDALONE ? '<p class=\"muted\">De database is nog niet ingesteld of niet bereikbaar. Probeer het over een paar minuten opnieuw.</p></div></main>' : " + old[:-1] + ");")

open(dst, 'w', encoding='utf-8').write(s)
print('OK', len(s))
