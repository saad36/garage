Garage v36.1 dashboard/data fix

Replace the existing index.html and app.js with the files in this ZIP.

Fixes:
- Dashboard KPIs are calculated from the same mileage/fuel/charging/maintenance history used by the vehicle pages.
- Monthly mileage and spending charts render directly on canvas and show "No data yet" only when appropriate.
- Audi fuel efficiency/cost summaries are populated.
- VISTIQ charging totals and cost/km include charging + maintenance.
- Mileage-based lease calculations use the latest VISTIQ mileage history.
- JSON import accepts the current export format plus several legacy/wrapped formats.
- JSON import resets the file picker so the same file can be imported again.
- Charging rate override correctly preserves an explicit $0 rate.
- History rows retain per-row delete controls.
- app.js is cache-busted from index.html with ?v=36.1.

After uploading to GitHub Pages, do a hard refresh/clear the site cache on the phone so the new app.js is loaded.
