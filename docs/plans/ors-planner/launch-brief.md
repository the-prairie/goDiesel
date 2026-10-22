# A route for the day you want

Status: working-backwards draft. Not a release announcement. Claims below require production evidence before publication.

## Customer promise

Choose where to start, how far to go, and what matters today. goDiesel compares mapped routes for running and cycling, explains the tradeoffs, and keeps the selected course ready to preview and take to your watch as GPX.

## The problem

Drawing a loop manually makes you guess whether its distance, climbing, surfaces, and surroundings match the day you want. A single unexplained generated line does not help you understand what you are choosing.

## Proposed experience

Ask for parks, nearby water, a hill preference, or paved surfaces. Inspect measured evidence for the selected candidate, including what the map data cannot tell us. Save the course, explore its 3D preview, and export GPX for import into the Suunto app. GPX import also preserves routes planned elsewhere.

## Customer questions

**Does this guarantee a scenic, quiet, paved, or safe route?** No. Evidence comes from mapped geometry, surface tags, and elevations. Quiet is a road-characteristic estimate, not measured noise or traffic. Missing data is disclosed.

**Does this send directly to my watch?** No. Download GPX, import it into the Suunto app, and sync through Suunto. Direct partner integration is outside this release.

**What if routing or geographic data fails?** Generation explains failures. A usable partial result must disclose how many candidates were actually compared and which preferences could not be evaluated.

**Why should I trust the launch demonstration?** The final video will use real production interactions after independent dogfood. A separate evidence list will distinguish verified behavior, limitations, and unfinished claims.

## Internal release questions

Can both activities finish despite a slow alternative? Can unknown evidence incorrectly improve rank? Are preferences visible again after saving? Can an agent use the same authenticated API? Can the owner discover the feature and finish without coaching? Are the deploy configuration and rollback path verified?
