Garage v37.1

Fixes the two blank charts from v37:
- Garage cost/km trend now derives monthly distance directly from canonical mileage history, with Audi fuel-odometer fallback.
- VISTIQ lease pace validates lease settings and renders actual vs target mileage independently.
- Each chart is isolated so one chart error cannot stop later charts.
- Non-finite chart values are filtered safely.
- Existing v37 chart labels, tap/hover details, VISTIQ efficiency KPI, cost/km metrics, and lease pace remain included.

Replace index.html and app.js in GitHub Pages.
After deployment, hard refresh/clear the site's cached data if the old JavaScript remains visible.
