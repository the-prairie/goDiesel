import {
  CalendarDays,
  CircleAlert,
  MapPinned,
  Mountain,
  Quote,
  Sparkles,
} from "lucide-react";

import type { RouteCuration } from "@/domain/routes";

export function RouteGuide({ curation }: { curation: RouteCuration }) {
  const isDraft = curation.reviewStatus === "draft";

  return (
    <article aria-label="Route guide" className="grid gap-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-primary">Route guide</p>
          <h2 className="mt-1 text-xl font-semibold">Plan for the experience.</h2>
        </div>
        <span className="text-xs font-medium text-muted-foreground">
          {reviewStatusLabel(curation.reviewStatus)}
        </span>
      </header>

      {isDraft && !hasEditorialContent(curation) ? (
        <p className="max-w-2xl text-sm text-muted-foreground">
          Editorial guidance has not been reviewed for this route.
        </p>
      ) : null}

      <div className="grid gap-7 lg:grid-cols-3">
        {curation.vibe ? (
          <GuideSection icon={Sparkles} title="What it feels like">
            <p>{curation.vibe}</p>
          </GuideSection>
        ) : null}
        {curation.idealUse ? (
          <GuideSection icon={MapPinned} title="Best for">
            <p>{curation.idealUse}</p>
          </GuideSection>
        ) : null}
        {curation.difficulty || curation.terrain ? (
          <GuideSection icon={Mountain} title="Terrain & difficulty">
            {curation.difficulty ? (
              <p className="font-medium text-foreground">{curation.difficulty}</p>
            ) : null}
            {curation.terrain ? <InlineList items={curation.terrain} /> : null}
          </GuideSection>
        ) : null}
      </div>

      <div className="grid gap-7 border-t border-border pt-7 md:grid-cols-2">
        {curation.highlights ? (
          <GuideSection icon={Sparkles} title="Highlights">
            <BulletList items={curation.highlights} />
          </GuideSection>
        ) : null}
        {curation.caveats ? (
          <GuideSection icon={CircleAlert} title="Watch for">
            <BulletList items={curation.caveats} />
          </GuideSection>
        ) : null}
        {curation.seasonality ? (
          <GuideSection icon={CalendarDays} title="Seasonality">
            <p>{curation.seasonality}</p>
          </GuideSection>
        ) : null}
        {curation.editorialNote ? (
          <GuideSection icon={Quote} title="Why it is here">
            <p>{curation.editorialNote}</p>
          </GuideSection>
        ) : null}
      </div>
    </article>
  );
}

function GuideSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Sparkles;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className="flex items-center gap-2 text-primary">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="mt-3 grid gap-2 text-sm leading-6 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-2">
      {items.map((item) => (
        <li key={item} className="grid grid-cols-[0.5rem_minmax(0,1fr)] gap-2">
          <span className="mt-2.5 size-1 rounded-full bg-primary" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function InlineList({ items }: { items: string[] }) {
  return <p>{items.join(" · ")}</p>;
}

function hasEditorialContent(curation: RouteCuration) {
  return Boolean(
    curation.vibe ||
      curation.idealUse ||
      curation.terrain ||
      curation.difficulty ||
      curation.highlights ||
      curation.caveats ||
      curation.seasonality ||
      curation.editorialNote,
  );
}

function reviewStatusLabel(status: RouteCuration["reviewStatus"]) {
  if (status === "published") return "Published guide";
  if (status === "reviewed") return "Reviewed guide";
  return "Draft guide";
}
