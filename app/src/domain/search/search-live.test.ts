import { externalSearchText, rankExternalRoutes } from "./external-ranking";
import type { ExternalRoute } from "./external";
import { beforeAll, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { pipeline } from "@huggingface/transformers";
import { searchCollection } from "@/data/discovery-provider";
import { interpretQuery } from "./intent";
import { routes } from "@/data/routes";
const docs = JSON.parse(
  readFileSync("public/search/collection.json", "utf8"),
).documents;
describe.skipIf(!process.env.GODIESEL_SEARCH_EVAL)(
  "real embedding retrieval evaluation",
  () => {
    let embed: Awaited<ReturnType<typeof makeModel>>;
    function makeModel() {
      return pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
        dtype: "q8",
      });
    }
    beforeAll(async () => {
      embed = await makeModel();
    }, 60_000);
    for (const [query, slug] of [
      ["a run past Westminster and Kensington Gardens", "14486170630"],
      ["a run through Prospect Park in Brooklyn", "9844581410"],
      ["a long run from Ocean Beach through Golden Gate Park", "14736711660"],
    ])
      it(`puts the grounded match first: ${query}`, async () => {
        const intent = interpretQuery(
          query,
          {
            place: "",
            activity: "Run",
            distanceKm: 0,
            terrain: "any",
            vibe: "",
          },
          routes.map((r) => r.region),
        );
        const vector = Array.from(
          (await embed(query, { pooling: "mean", normalize: true })).data,
        ) as number[];
        expect(
          searchCollection(intent, docs, vector).candidates[0].sourceRouteSlug,
        ).toBe(slug);
      });
    it("ranks sourced discovery descriptions by meaning", async () => {
      // Source text from the live Banff OSM results, 2026-10-14.
      const candidates = [
        {id:"osm-15402550",name:"Policeman's Creek Boardwalk"},
        {id:"osm-13623938",name:"Stoney Lookout", description:"The Stoney Lookout offers views of Cascade Mountain and the Bow Valley below. Along the way, the trail passes through a forest of trees covered in wispy lichen."},
        {id:"osm-18100002",name:"Cascade Fire Road"},
      ].map(r=>({...r,activity:"Run",distanceKm:3,distanceKind:"mapped",lines:[],sourceUrl:""}) as ExternalRoute);
      const query="a woodland outing with a panorama";
      const vectors = [];
      for(const text of [query,...candidates.map(externalSearchText)]) vectors.push(Array.from((await embed(text,{pooling:"mean",normalize:true})).data) as number[]);
      const ranked=rankExternalRoutes(candidates,query,vectors);
      expect(ranked[0].route.name).toBe("Stoney Lookout");
      expect(ranked[0].reason).toBe("Related to your description");
    });
    it("finds waterfront themes without needing that exact word in every guide", async () => {
      const query = "a seaside run near Victoria";
      const intent = interpretQuery(
        query,
        { place: "", activity: "Run", distanceKm: 0, terrain: "any", vibe: "" },
        routes.map((r) => r.region),
      );
      const vector = Array.from(
        (await embed(query, { pooling: "mean", normalize: true })).data,
      ) as number[];
      const result = searchCollection(intent, docs, vector);
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates[0].route.region).toContain("Victoria");
      expect(result.candidates[0].route.guide.vibe).toMatch(
        /water|shore|coast/i,
      );
    });
  },
);
