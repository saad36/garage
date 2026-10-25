Garage v38.8.1 — monthly activity table fix

Fixes:
- Monthly activity table now uses the available card width instead of inheriting
  the 540px minimum width used by detailed history tables.
- Compact column widths and smaller mobile-safe padding prevent the Spend column
  from being clipped on narrow screens.
- Month labels are explicit (e.g. Sep '26) rather than relying on locale output.

No garage records or backup data are changed.

Replace index.html and app.js at the root of the repository. Keep index.html
named exactly as shown.
