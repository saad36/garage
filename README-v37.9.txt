Garage v37.9 — exact JSON charging-key fix

Inspected the uploaded backup file. Its charging records are stored under the
top-level key "charge", not "charging".

The importer now explicitly reads:
  charge -> charging -> chargingHistory -> chargeHistory -> charges

The uploaded backup contains 4 charging records:
- 2026-08-26: 66.5 kWh, $6.517
- 2026-08-31: 29.8 kWh, $0.00
- 2026-08-31: 21.3 kWh, $2.0874
- 2026-09-01: 72.5 kWh, $0.00

So the imported total should be 190.1 kWh and $8.6044.

ZIP root:
- index.html
- app.js
- README-v37.9.txt
