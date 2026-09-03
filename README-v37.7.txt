Garage v37.7 — Charging data fix

Fixed:
- Charging entry now reads the actual vKwh input field (previous code incorrectly read vEnergy).
- JSON import accepts additional common charging energy field names.
- JSON import accepts additional charging cost field names.
- Explicit $0.00 rates/costs remain valid and are not replaced by defaults.
- app.js is cache-busted as v37.7.

Files at ZIP root:
- index.html
- app.js
- README-v37.7.txt

Replace index.html and app.js in GitHub Pages. Existing data is preserved.
