"use client";

import type { ExploreSearchResponse } from "@/types/explore";

export function ExploreSearchContext({ response, pending, onAreaSelect, onEditLocation }: {
  response: ExploreSearchResponse;
  pending: boolean;
  onAreaSelect: (location: string) => void;
  onEditLocation: () => void;
}) {
  if (response.error || response.lookupFailed || pending) return null;
  const choices = response.areaCandidates?.slice(0, 8) ?? [];
  const ambiguous = response.areaAmbiguous && response.locationOrigin === "query";
  const alternateArea = response.queryLocationHint?.trim();
  if (!ambiguous && !response.locationConflict) return null;
  return (
    <div className="mx-auto grid w-full gap-3 px-4 pt-4 text-sm text-text-secondary sm:px-6 lg:pl-8 lg:pr-3" data-testid="explore-search-context">
      {response.locationConflict ? (
        <div className="flex flex-wrap items-center gap-2" role="status">
          <span>Searching in {response.location}, your selected area.</span>
          <button type="button" onClick={onEditLocation} className="rounded-full bg-surface-muted px-3 py-2 font-semibold text-text-primary">Change location</button>
          {!response.areaAmbiguous && alternateArea ? <button type="button" onClick={() => onAreaSelect(alternateArea)} className="rounded-full bg-surface-muted px-3 py-2 font-semibold text-text-primary">Use {alternateArea}</button> : null}
        </div>
      ) : null}
      {ambiguous || response.locationConflict && response.areaAmbiguous && choices.length ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="Choose a city">
          {ambiguous ? <span>Which city do you mean?</span> : <span>Or choose:</span>}
          {choices.map(area => <button key={area.label} type="button" onClick={() => onAreaSelect(area.label)} className="rounded-full bg-surface-muted px-3 py-2 font-semibold text-text-primary">{area.label}</button>)}
        </div>
      ) : null}
    </div>
  );
}
