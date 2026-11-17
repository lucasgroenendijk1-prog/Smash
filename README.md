# SMASH.

Padel-app, live op https://smash-qoos.onrender.com (Render, automatisch bij elke push naar `main`).

## Updates van de Claude-versie naar Render

De app wordt ontwikkeld als Claude-artifact ("Smash"). Om een nieuwe versie live te zetten:

1. Download de nieuwste `index.html` van het artifact.
2. `python3 tools/to_render.py <artifact-index.html> index.html`
   (voegt de Supabase-koppeling, Google-titel en -beschrijving toe)
3. Commit en push naar `main`; Render zet hem binnen een minuut online.

Bestanden: `db.js` (database op Supabase), `config.js` (Supabase-URL en publishable key),
`clubs-seed.json` (clubs voor een lege database), `robots.txt` en `sitemap.xml` (Google).
