# Fit design reference

Theme: **Midnight**, light and dark, following the system setting. Light is the primary reference.

## Mockups

`docs/mockups/light/*.html` and `docs/mockups/dark/*.html` are static design sources (390 x 844 phone frames). They were authored for a design canvas, so they won't render on their own. Read them as markup: layout, spacing, sizes, copy and colors are all inline styles. Dynamic lists are `<sc-for>` blocks with their data in the `renderVals()` script at the bottom of each file. Repeated rows come from that data.

| Screen | File |
|---|---|
| Today (day widget, checklist) | `Today.html` |
| Day widget states | `Widget-Morning.html`, `Widget-Evening.html`, `Widget-Rest.html` |
| In-run, heart rate step | `Run.html` |
| In-run, pace step | `RunPace.html` |
| In-run, sprint step | `RunSprint.html` |
| Run summary | `Summary.html` |
| Plan, this week | `Plan.html` |
| Plan, schedule | `Schedule.html` |
| Run plan manager | `PlanManager.html` |
| Run workout builder | `RunBuilder.html` |
| Strength logging | `Strength.html` |
| Workout finished | `WorkoutDone.html` |
| Guided stretch player | `Stretch.html` |
| Library | `Library.html` |
| Stats | `Stats.html` |
| Setup: heart rate zones | `SetupZones.html` |
| Setup: running plan | `SetupPlan.html` |
| New activity from Garmin | `NewActivity.html` |
| Move to another day | `Move.html` |
| Quick log | `QuickLog.html` |

## Tokens

Font: **Inter** (400, 500, 600, 700). Numbers use tabular figures.

### Neutrals

| Token | Light | Dark |
|---|---|---|
| bg | `#F7F7F8` | `#111214` |
| surface (cards) | `#FFFFFF` | `#1A1B1F` |
| surface-muted / inset | `#F2F2F4` | `#17181B` |
| segmented track | `#EBEBEE` | `#1A1B1F` |
| border | `#DCDCE0` | `#2E2F35` |
| divider | `#EDEDF0` | `#1D1E22` |
| text | `#141518` | `#ECECEE` |
| text-secondary | `#62636B` | `#9C9DA5` |
| text-tertiary | `#6B6C74` | `#7C7D85` |
| primary button bg / fg | `#141518` / `#F7F7F8` | `#ECECEE` / `#111214` |

### Activity colors (muted; color marks type, never decoration)

| Type | Light (color / tint / text-on-tint) | Dark (color / tint) |
|---|---|---|
| Run, easy, HR steps | `#4F8DB0` / `#E1ECF2` / `#2F6A8C` | `#6FA8C7` / `#1C2730` |
| Strength | `#8C83C0` / `#ECEAF5` / `#5E5596` | `#9C93C9` / `#24222F` |
| Stretch, success | `#5F9370` / `#E3EEE5` / `#3F6E4C` | `#8DB596` / `#1F2A22` |
| Pace and harder efforts | `#C9A273` / `#F3EADF` / `#7A5530` | to define |
| Sprint | `#B97A5B` / `#F5E4DC` / `#7E4630` | to define |
| Walk, recovery | `#D0D0D5` | `#4B4E57` |
| Steps (bars, goal dots) | `#7DB9E3` | `#8FC6EC` |
| Weight (trend line, progress) | `#5E9C9E` | `#86BFC1` |

Other activity types (quick log, watch imports) reuse the nearest family above, icon and tint alike, so the palette stays at five hues:

| Activity | Family |
|---|---|
| Run, treadmill, swim | Run (blue) |
| Hike, stretch | Stretch (green) |
| Lift, strength | Strength (violet) |
| Bike | Pace (amber) |
| Walk, other | Walk (grey) |

### Shape and motion
- Card radius 14-20, buttons 12-14, pills fully rounded. Touch targets at least 44 px.
- Motion 150-250 ms, UI thread only, never delays an action.

## Icons
Lucide drawings (ISC, lucide.dev), drawn with `react-native-svg` in `apps/mobile/src/ui/icons.tsx`, the same approach as murmur. No icon package. 24-unit grid, 2 px round strokes, outline; player controls filled. Activity tiles: `footprints` (run), `biceps-flexed` (strength), `person-standing` (stretch) in the lane color on the lane tint. Screens import icons only from that file.

## Copy rules
- No middle-dot separators and no em or en dashes in UI text. Use layout, or a comma within one line. Ranges use a hyphen: "128-145 bpm".
- No emoji, no exclamation marks, no cheerleading. State facts: "Workout saved", "3 of 3 done this week".
- Sentence case, short literal labels, units always shown.
- These rules apply to notifications and voice cues too.
