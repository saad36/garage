Garage v38.7 — insight grouping, chart labels, tracking-period average

- Grouped Garage insights into Driving & mileage, Spending, Efficiency & running cost,
  and Lease tracking.
- Reduced chart label clutter: line charts label at most four non-zero points; all
  points remain available through tap/pointer tooltips.
- Stacked mileage values are shown inside bars only when segments are tall enough,
  preventing Audi/VISTIQ segment labels from overlapping.
- Average km/month now uses total recorded distance divided by elapsed months since
  the earliest Audi or VISTIQ odometer tracking date, rather than dividing year-to-date
  distance by the number of months in the calendar year.
- No records are modified.

ZIP root: index.html, app.js, README-v38.7.txt
