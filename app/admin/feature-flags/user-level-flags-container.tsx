"use client";

import { useEffect, useState } from "react";

import { useToast } from "@/hooks/use-toast";
import {
  createFeatureFlag,
  getUsers,
  updateFeatureFlag,
} from "@/lib/db_actions";
import type { VFeatureFlag, VUser } from "@/types/db_types";

import { SettingToggle, useSettingSave } from "@/components/setting-toggle/setting-toggle";

/**
 * The per-user overrides for one feature, printed under the feature's own row
 * rather than inside a popover: a handful of names is worth two inches of
 * paper, and hiding them behind a count hides the exceptions, which are the
 * only reason anyone opens this page.
 */
export const userFlagsCss = `
.hxp .uflags { padding: 0.25rem 0 1.25rem 1.5rem; }
.hxp .uhead {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--rule);
}
.hxp .urow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 5.5rem;
  gap: 0 1.5rem;
  align-items: baseline;
  padding: 0.625rem 0;
  border-bottom: 1px solid var(--rule);
}
.hxp .urow .who {
  min-width: 0;
  font-size: 0.9375rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hxp .urow .who .uid {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-faint);
  margin-right: 0.625rem;
}
.hxp .uflags .empty {
  color: var(--ink-muted);
  font-size: 0.875rem;
  padding: 0.75rem 0;
}
.hxp .upick {
  display: block;
  width: 100%;
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  color: var(--ink);
  background: none;
  border: 0;
  border-bottom: 1px solid var(--rule);
  padding: 0 0 0.3125rem;
  cursor: pointer;
  outline: none;
  appearance: none;
}
.hxp .upick:focus { border-bottom-color: var(--ink); }
.hxp .uact {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
  background: none;
  border: 0;
  border-bottom: 1px solid color-mix(in oklab, var(--ink) 40%, transparent);
  padding: 0 0 0.25rem;
  margin-top: 1rem;
  cursor: pointer;
  white-space: nowrap;
}
.hxp .uact:hover { color: var(--red-text); border-bottom-color: var(--red-text); }
`;

/** One person's override, and the control that sets it. */
function UserFlagRow({
  flag,
  onChange,
}: {
  flag: VFeatureFlag;
  onChange: () => void;
}) {
  const { toast } = useToast();
  const { value, busy, set } = useSettingSave(flag.enabled);
  const who = flag.user_name ?? `User ${flag.user_id}`;
  return (
    <div className="urow">
      <span className="who">
        <span className="uid">{flag.user_id}</span>
        {who}
      </span>
      <SettingToggle
        label={who}
        value={value}
        busy={busy}
        onSet={(enabled) =>
          set(enabled, async () => {
            const result = await updateFeatureFlag({ id: flag.id, enabled });
            if (!result.success) {
              toast({
                title: "Error",
                description: result.error,
                variant: "destructive",
              });
              return false;
            }
            toast({
              title: "Feature flag updated",
              description: `${who} is now ${enabled ? "on" : "off"}.`,
            });
            onChange();
            return true;
          })
        }
      />
    </div>
  );
}

/** The row that adds an override: pick a forecaster, then set them off or on. */
function AddUserFlagRow({
  featureName,
  excludeUserIds,
  onAdded,
  onCancel,
}: {
  featureName: string;
  excludeUserIds: number[];
  onAdded: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [users, setUsers] = useState<VUser[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const { value, busy, set } = useSettingSave(null);

  useEffect(() => {
    let live = true;
    getUsers().then((result) => {
      if (!live) return;
      if (result.success) {
        setUsers(result.data);
      } else {
        toast({
          title: "Error",
          description: "Failed to load users",
          variant: "destructive",
        });
      }
    });
    return () => {
      live = false;
    };
  }, [toast]);

  // Filtered here rather than at fetch time, so the list stays right as
  // overrides are added without refetching every person in the database.
  const taken = new Set(excludeUserIds);
  const choices = (users ?? []).filter((user) => !taken.has(user.id));
  const selected = choices.find((user) => user.id === chosen) ?? null;

  return (
    <>
      <div className="urow">
        <select
          className="upick"
          aria-label={`Forecaster to override ${featureName} for`}
          value={chosen === null ? "" : String(chosen)}
          onChange={(event) =>
            setChosen(
              event.target.value === "" ? null : Number(event.target.value),
            )
          }
        >
          <option value="">
            {users === null ? "Loading forecasters…" : "Choose a forecaster…"}
          </option>
          {choices.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
        {/* Nothing to switch until someone is named, so the control reads as
            unset and takes no press until then. */}
        <SettingToggle
          label={selected ? selected.name : "New override"}
          value={value}
          busy={busy}
          onSet={
            selected
              ? (enabled) =>
                  set(enabled, async () => {
                    const result = await createFeatureFlag({
                      featureFlag: {
                        name: featureName,
                        user_id: selected.id,
                        enabled,
                      },
                    });
                    if (!result.success) {
                      toast({
                        title: "Error",
                        description: result.error,
                        variant: "destructive",
                      });
                      return false;
                    }
                    toast({
                      title: "User-level flag created",
                      description: `${selected.name} is now ${
                        enabled ? "on" : "off"
                      } for "${featureName}".`,
                    });
                    onAdded();
                    return true;
                  })
              : undefined
          }
        />
      </div>
      <button type="button" className="uact" onClick={onCancel}>
        Cancel
      </button>
    </>
  );
}

/**
 * Every per-user override of one feature.
 *
 * Sorted by name: the question asked here is "is this on for so-and-so", and
 * the ids the view carries are only there to tell two people of one name
 * apart.
 */
export function UserLevelFlagsContainer({
  featureName,
  flags,
  onChange,
}: {
  featureName: string;
  flags: VFeatureFlag[];
  /** Called after any change, so the sheet can refetch the server's copy. */
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const ordered = [...flags].sort((a, b) =>
    (a.user_name ?? "").localeCompare(b.user_name ?? ""),
  );
  const excludeUserIds = flags
    .map((flag) => flag.user_id)
    .filter((id): id is number => id !== null);

  return (
    <div className="uflags">
      <div className="uhead">Forecaster</div>
      {ordered.length === 0 && !adding && (
        <p className="empty">
          Nobody overrides this feature; everyone gets the default.
        </p>
      )}
      {ordered.map((flag) => (
        <UserFlagRow key={flag.id} flag={flag} onChange={onChange} />
      ))}
      {adding ? (
        <AddUserFlagRow
          featureName={featureName}
          excludeUserIds={excludeUserIds}
          onAdded={() => {
            setAdding(false);
            onChange();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" className="uact" onClick={() => setAdding(true)}>
          + Add forecaster
        </button>
      )}
    </div>
  );
}
