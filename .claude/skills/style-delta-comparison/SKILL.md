---
name: style-delta-comparison
description: Use when auditing style/CSS parity between a source website and an in-progress rebuild — comparing fonts, colors, padding, border-radius, max-width, and other computed styles across matched elements to find and report visual deltas.
---

# Style Delta Comparison

## Overview

Captures computed CSS from a source site and an in-progress rebuild, diffs them
element-by-element, and reports every meaningful delta grouped by category
(typography, color, spacing, radius/sizing, border/shadow).

## When to use

- Verifying visual fidelity of a migration/rebuild against the original site
  (e.g., an EDS migration checked against the live source it's replacing)
- Any "does my rebuild match the source" style audit

## Workflow

1. **Ask for both URLs before doing anything else, in chat (not a form/multiple-choice tool — these are free-text URLs):**
   - "What's the source site URL (the original/reference)?"
   - "What's the in-progress site URL (the rebuild), and which page/path should I compare?"
   Wait for both answers. Don't assume `localhost:3000` even if it seems obvious from
   project context — confirm the exact path being compared on each side.

2. **Inspect both pages before picking selectors.** Use `read_page` or
   `get_page_text` on each URL first — don't blindly apply the default selector
   list below to a page that doesn't have those elements. Adjust the list to
   what's actually present, and make sure a given selector picks out
   *structurally equivalent* elements on both sides (e.g. don't diff the
   source's `.hero-title` against the rebuild's generic `h1` unless they're
   really the same element).

   Default selector set:
   `body, h1, h2, h3, h4, p, a, button, nav, header, footer, main, .card, img`

3. **Extract computed styles from both pages.** Open `extract-styles.js` in
   this skill directory, fill in the `SELECTORS` array for the page being
   audited, and run the whole file's contents through the browser tool's
   `javascript_tool` (`mcp__Claude_Browser__javascript_tool`) against each URL.
   Save each result with `Write` to a scratch JSON file (e.g.
   `source.styles.json` / `target.styles.json`) — `compare-styles.js` reads
   these as input.

4. **Diff the two captures:**
   ```bash
   node .claude/skills/style-delta-comparison/compare-styles.js source.styles.json target.styles.json report.md
   ```
   This produces a Markdown delta table grouped by category, applying the
   tolerance rules below so rendering noise doesn't show up as a false delta.

5. **Report and offer fixes.** Show the table to the user. For each delta,
   suggest the concrete CSS change in the rebuild (which block's `*.css` file
   or `styles/styles.css`, per this project's structure) — don't apply changes
   without confirmation.

## Property coverage

| Category | Properties |
|---|---|
| Typography | font-family, font-size, font-weight, line-height, letter-spacing, text-transform |
| Color | color, background-color, border-color |
| Spacing | padding (4 sides), margin (4 sides), gap |
| Radius & sizing | border-radius, max-width, width |
| Border & shadow | border-width, border-style, box-shadow |

## Tolerance

- Spacing/radius/sizing: ignore differences ≤ 1px (subpixel rounding).
- Color: treat as equal if each RGB channel is within 6 (anti-aliasing/rendering noise).
- Everything else (font-family, font-weight, text-transform, etc.): exact string match required.

`compare-styles.js` implements these rules — don't hand-diff raw computed-style
strings without them, or every page will show hundreds of false deltas.

## Files

- `extract-styles.js` — template to paste into `javascript_tool`; captures
  computed styles per selector (up to 5 matches each) as a JSON-serializable
  object.
- `compare-styles.js` — Node script (no dependencies), diffs two capture files
  into a Markdown report.

## Common mistakes

- Comparing elements that don't structurally correspond between the two sites.
- Extracting styles before fonts/images finish loading — take a screenshot
  first to sanity-check the page looks settled.
- Skipping the tolerance rules and treating every subpixel/anti-aliasing
  difference as a real delta — use `compare-styles.js`, not a raw string diff.
- Reusing one site's default selector list against the other site's DOM
  without checking it actually matches something structurally equivalent.
