# Replay route stories

These editorial chapters describe a particular recorded route. They are not
geocoded from activity titles, inferred from AI curation, or navigation advice.
Only the San Francisco activity `14736711660` has a reviewed story so far.
Other recordings retain terrain chapters.

The San Francisco names and representative coordinates come from OpenStreetMap,
retrieved on October 20, 2026. Every place includes its original node or way URL.
The place data is © OpenStreetMap contributors and is distributed under the
[Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).

Chapter boundaries and summary text are editorial choices based on the recorded
trace. They do not assert exact neighborhood boundaries, current access, or a
visit inside a nearby landmark. The park and coastal sequence was also checked
against [Golden Gate Park](https://www.sfrecpark.org/770/Golden-Gate-Park),
[the Panhandle](https://sfrecpark.org/facilities/facility/details/Panhandle-443),
and [Ocean Beach](https://www.nps.gov/goga/planyourvisit/oceanbeach.htm).

The pure story selector accepts a story only for the matching activity and
geometry signature. The signature covers the complete latitude, longitude, and
distance sequence, the activity distance, and the recording-gap boundaries.
It is an invalidation key, not a security check. A renamed activity or corrected
elevation does not change geographic anchors.

To add another story, review its recorded trace against named map features,
store the source coordinates and links, and choose chapter boundaries on
recorded distances. Nearby-place anchors must belong to their chapter and lie
within 250 meters of the sourced representative coordinate. Compute the signature
with `replayRouteGeometrySignature` on the parsed route. Register the data in
`replay-route-story.ts`, then add real-route tests for coverage, source anchors,
stale-data rejection, and playback behavior. Do not reuse this story for another
San Francisco activity merely because it shares a region name.
