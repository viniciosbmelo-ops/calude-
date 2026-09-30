import * as React from "react";
import {
  APPLICATION_ANATOMICAL_SITE_GROUPS,
  anatomicalSiteGroupLabel,
  anatomicalSiteLabel,
  anatomicalSiteNeedsDetail,
  isOfferedAnatomicalSite,
} from "@/lib/regen-application-sites";

export interface AnatomicalStructureSelectProps {
  /** Row index (ids/test ids: application-structure-<index>). */
  index: number;
  value: string;
  detail: string;
  locale: string;
  labels: {
    /** Empty option ("—"). */
    placeholder: string;
    /** Header of a stored value the current catalog no longer offers. */
    previous: string;
    /** Placeholder / accessible name of the "especificar" free text. */
    detail: string;
  };
  onChange: (value: string) => void;
  onDetailChange: (detail: string) => void;
}

const FIELD_CLASS =
  "text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400";

/**
 * "Estrutura anatômica" of one application site: a native select with one
 * optgroup per region (typing jumps to a matching option). A stored legacy
 * code (or unknown value) stays selectable under its own header so editing
 * never drops it; "Músculo"/"Outro" reveal a free-text complement.
 */
export function AnatomicalStructureSelect({
  index, value, detail, locale, labels, onChange, onDetailChange,
}: AnatomicalStructureSelectProps) {
  return (
    <>
      <select
        id={`application-structure-${index}`}
        data-testid={`application-structure-${index}`}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={FIELD_CLASS}
      >
        <option value="">{labels.placeholder}</option>
        {!isOfferedAnatomicalSite(value) && (
          <optgroup label={labels.previous}>
            <option value={value}>{anatomicalSiteLabel(value, locale)}</option>
          </optgroup>
        )}
        {APPLICATION_ANATOMICAL_SITE_GROUPS.map(({ group, sites }) => (
          <optgroup key={group.code} label={anatomicalSiteGroupLabel(group, locale)} data-group={group.code}>
            {sites.map(option => (
              <option key={option.code} value={option.code}>{anatomicalSiteLabel(option.code, locale)}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {anatomicalSiteNeedsDetail(value) && (
        <input
          type="text"
          data-testid={`application-structure-detail-${index}`}
          aria-label={labels.detail}
          placeholder={labels.detail}
          value={detail}
          maxLength={120}
          onChange={e => onDetailChange(e.target.value)}
          className={FIELD_CLASS}
        />
      )}
    </>
  );
}
