# Finder evidence assessment (2026-09-28)

A dated observation, not canonical prose: counts are from the generated data
on branch `feat/adventure-showcase` and will drift.

## What Finder had

Four hand-picked candidates in `app/src/data/discovery-provider.ts`, each with
terrain and "vibe" words written in source. Matching is region substring,
activity, distance within 30% (minimum 3 km), a terrain word and vibe
substrings. The candidate card showed **Surface** in the same metric row as
recorded distance and climb, under a "recorded" badge, although nothing
measured it, and the match reason said "the <vibe> feeling".

## What the evidence supports

| Attribute | Coverage (68 routes) | Evidence class | Finder use |
| --- | --- | --- | --- |
| Distance | 68 | derived (build.py accumulates coordinate steps) | compare with the plan (implemented) |
| Climb (elevation gain) | 68 recorded elevation | derived (build.py sums elevation deltas) | shown (implemented) |
| Climb rate (m/km) | 68 | derived from recorded climb and distance | shown (implemented) |
| Steepest sustained grade | 68 | derived; the manifest trace is sampled, so needs route detail | deferred |
| Recording gaps | 53 routes have discontinuities | recorded | not a quality signal; not used |
| Elapsed time / pace | 67 recorded | the owner's own day | never a difficulty rating; not used |
| Reviewed curation (vibe, terrain, difficulty, caveats, seasonality) | 2 reviewed, 1 draft | hypothesis (owner editorial) | unsupported at scale |
| Finder terrain and vibe words | 4 candidates, in code | owner tags, unlabelled | shown as the owner's tags only |
| Surface, difficulty, safety, current access, solitude | 0 | cannot be established from a GPX | named as not judged |

## Changed

- `app/src/domain/planning-evidence.ts`: comparison computed from the
  recording (distance delta, climb, climb rate), each labelled derived with its
  own explanation; owner tags kept as tags; the
  attributes a recording cannot establish are listed.
- The candidate card's metric row is measured values only; "Surface" is gone;
  the match reason says what matched without claiming a feeling.

## Deferred, with dependencies

- **Experiential comparison** ("wilder than", "quieter than"): needs reviewed
  curation on more than 2 routes; the curation workflow is ADR-0010.
- **Surface / road-versus-trail**: derivable only by matching the track to an
  external map (for example OpenStreetMap `highway`/`surface` tags). That is
  provider-derived, time-bound evidence and would need its own label.
- **Model-assisted phrasing** of a plan: would sit behind the existing Admin
  and loopback access controls, never in the frame loop, with no new
  subscription or credential. Not started.
