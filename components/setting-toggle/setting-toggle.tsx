"use client";

import { useState } from "react";

/**
 * The sheet's switch: one on/off setting, wherever the app keeps one. The
 * admin's feature flags and the reader's notification settings both print it.
 *
 * Design note. This was two mono words on one continuous line, with the line
 * under the live word inked to 2px and the dead half left as a 1px hairline.
 * It was too quiet to read: at a glance neither word looked chosen, and on a
 * setting with no stored row at all — where neither IS chosen — there was
 * nothing to tell the two situations apart.
 *
 * So it is the same segmented bar the prop lists filter with: connected cells,
 * the live one a plate of ink. One filled cell means the setting is stored and
 * says which way; no filled cell means there is no row yet, and the caption
 * beside it says so in words. Both cells stay live in that state, and pressing
 * either writes the row with that value — a single toggling button could
 * express neither the absence nor the creation.
 *
 * A notification preference is never `null` in practice: a reader who has
 * never chosen still shows the registry's default, because that is what they
 * are actually getting.
 */
export const toggleCss = `
/* The bar itself is .riso-seg, from globals. These are the two things a
   setting needs that a filter does not. */
.riso-seg.flip button { min-width: 3.25rem; justify-content: center; }
/* In flight: the reading is the one you asked for, printed in the softer ink
   until the server confirms it. */
.riso-seg.flip.busy button[aria-pressed="true"] {
  background: color-mix(in oklab, var(--riso-ink) 70%, transparent);
}
.riso-seg.flip button:disabled { cursor: default; }
`;

export function SettingToggle({
  label,
  value,
  onSet,
  busy = false,
}: {
  /** Names what is being switched, for assistive tech: a feature, a person. */
  label: string;
  /** `null` when no row exists yet — neither state is live. */
  value: boolean | null;
  /** Omit for a read-only reading of the setting. */
  onSet?: (enabled: boolean) => void;
  /** True while a save is in flight, so `value` is what was asked for. */
  busy?: boolean;
}) {
  const states: boolean[] = [false, true];
  return (
    <span className={busy ? "riso-seg flip busy" : "riso-seg flip"}>
      {states.map((state) => (
        <button
          key={String(state)}
          type="button"
          aria-pressed={value === state}
          aria-label={`${label} ${state ? "on" : "off"}`}
          disabled={onSet === undefined || busy}
          onClick={() => {
            if (value !== state) onSet?.(state);
          }}
        >
          {state ? "On" : "Off"}
        </button>
      ))}
    </span>
  );
}

/**
 * What the control should read while a save is in flight.
 *
 * The page is drawn from the server's copy of the setting, so a press would
 * otherwise keep showing the old value for the length of the round trip and
 * the refresh behind it — which reads as "nothing happened". This holds the
 * asked-for value in front of the server's until the two agree, and puts it
 * back if the save is refused.
 */
export function useSettingSave(actual: boolean | null) {
  const [wanted, setWanted] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  if (wanted !== null && wanted === actual) setWanted(null);

  /** Runs `save`, holding the control at `next` until the server agrees. */
  const set = async (next: boolean, save: () => Promise<boolean>) => {
    setWanted(next);
    setSaving(true);
    const saved = await save();
    setSaving(false);
    if (!saved) setWanted(null);
  };

  return { value: wanted ?? actual, busy: saving, set };
}
