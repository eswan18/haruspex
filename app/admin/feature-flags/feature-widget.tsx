"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { sheetCss } from "@/components/prop-list/sheet";
import { useToast } from "@/hooks/use-toast";
import { createFeatureFlag, updateFeatureFlag } from "@/lib/db_actions";
import type { VFeatureFlag } from "@/types/db_types";

import { SettingToggle, toggleCss, useSettingSave } from "@/components/setting-toggle/setting-toggle";
import {
  UserLevelFlagsContainer,
  userFlagsCss,
} from "./user-level-flags-container";

const ownCss = `
/* One table for the page, not a card per feature: the only question worth
   asking here is which features are on, and that is a column you read down. */
.hxp .flags {
  display: grid;
  /* the two settings columns are the control's width plus the gutter that
     each cell carries as padding */
  grid-template-columns: minmax(0, 1fr) 11.5rem 9rem;
  gap: 0;
  align-items: stretch;
}
/* Every row hands its cells straight to the grid, so the columns are the
   page's and not each row's. */
.hxp .flaghead,
.hxp .frow { display: contents; }

.hxp .flaghead > span {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
  padding: 1.25rem 0 0.5rem;
  border-bottom: 1px solid var(--rule);
}
.hxp .flaghead > span + span { padding-left: 1.5rem; }

.hxp .frow > * {
  padding: 0.875rem 0;
  line-height: 1.5rem;
  border-bottom: 1px solid var(--rule);
}
/* The gutter goes in the shorthand, not after it: a longhand padding-left set
   before the padding shorthand is reset by it, which is how the header ended up
   indented and the row it heads did not. */
.hxp .frow > * + * { padding: 0.875rem 0 0.875rem 1.5rem; }
/* A feature is a name in code, so it is set in code. */
.hxp .frow .nm {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.8125rem;
  letter-spacing: 0.02em;
  overflow-wrap: anywhere;
}
/* the control and its state annotation on one line, so the control's rule
   sits under the control and nothing else */
.hxp .frow .def {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}
.hxp .frow .unset {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-faint);
  white-space: nowrap;
}

.hxp .frow .expand {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
  background: none;
  border: 0;
  border-bottom: 1px solid transparent;
  padding: 0 0 0.125rem;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
}
.hxp .frow .expand:hover { color: var(--red-text); border-bottom-color: var(--red-text); }
.hxp .frow .expand .n {
  color: var(--ink);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.hxp .frow .expand .none { color: var(--ink-faint); }
.hxp .frow .expand .car { color: var(--ink-faint); margin-left: 0.5rem; }

/* The overrides print under the feature they belong to, indented and closed
   off by their own rule. */
.hxp .flags > .uflags {
  grid-column: 1 / -1;
  border-bottom: 1px solid var(--rule);
}

.hxp .failed { color: var(--red-text); padding-top: 1.5rem; }

@media (max-width: 46rem) {
  .hxp .flags { grid-template-columns: 6.5rem minmax(0, 1fr); }
  .hxp .flaghead > span:first-child { grid-column: 1 / -1; }
  .hxp .flaghead > span + span { display: none; }
  /* the feature names the row; its two settings sit on the line below */
  .hxp .frow .nm {
    grid-column: 1 / -1;
    border-bottom: 0;
    padding-bottom: 0.25rem;
  }
  .hxp .frow > * + * { padding-left: 0; }
  .hxp .frow .users { padding-left: 1.5rem; }
  .hxp .flags > .uflags { padding-left: 0; }
}
`;

/** One feature: its default, and a way into its per-user overrides. */
function FeatureRow({
  featureName,
  flags,
  onChange,
}: {
  featureName: string;
  flags: VFeatureFlag[];
  onChange: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const defaultFlag = flags.find((flag) => flag.user_id === null);
  const userFlags = flags.filter((flag) => flag.user_id !== null);
  // No default row at all is a third reading, not a synonym for off: an unset
  // feature is off for everyone, but nobody has said so yet.
  const { value, busy, set } = useSettingSave(
    defaultFlag ? defaultFlag.enabled : null,
  );

  const setDefault = (enabled: boolean) =>
    set(enabled, async () => {
      const result = defaultFlag
        ? await updateFeatureFlag({ id: defaultFlag.id, enabled })
        : await createFeatureFlag({
            featureFlag: { name: featureName, user_id: null, enabled },
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
        title: defaultFlag ? "Feature flag updated" : "Default flag created",
        description: `The default for "${featureName}" is now ${
          enabled ? "on" : "off"
        }.`,
      });
      onChange();
      return true;
    });

  return (
    <>
      <div className="frow">
        <span className="nm">{featureName}</span>
        <span className="def">
          <SettingToggle
            label={`${featureName} default`}
            value={value}
            busy={busy}
            onSet={setDefault}
          />
          {value === null && <span className="unset">Not set</span>}
        </span>
        <span className="users">
          <button
            type="button"
            className="expand"
            aria-expanded={open}
            aria-label={`${featureName} — ${userFlags.length} user-level flag${
              userFlags.length === 1 ? "" : "s"
            }`}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
          >
            {userFlags.length === 0 ? (
              <span className="none">No users</span>
            ) : (
              <>
                <span className="n">{userFlags.length}</span>{" "}
                {userFlags.length === 1 ? "user" : "users"}
              </>
            )}
            <span className="car" aria-hidden="true">
              {open ? "▴" : "▾"}
            </span>
          </button>
        </span>
      </div>
      {open && (
        <UserLevelFlagsContainer
          featureName={featureName}
          flags={userFlags}
          onChange={onChange}
        />
      )}
    </>
  );
}

/**
 * Every feature the app knows about, and what it is set to.
 *
 * Drawn from the server's copy of the flags, refetched after every change:
 * this page is the one place the flags are written from, so it should never
 * show a reading the database does not hold.
 */
export function FeatureFlagsSheet({
  flags,
  error = null,
}: {
  flags: VFeatureFlag[];
  error?: string | null;
}) {
  const router = useRouter();
  const onChange = useCallback(() => router.refresh(), [router]);

  const byName = new Map<string, VFeatureFlag[]>();
  for (const flag of flags) {
    const rows = byName.get(flag.name);
    if (rows) rows.push(flag);
    else byName.set(flag.name, [flag]);
  }
  const featureNames = Array.from(byName.keys()).sort();

  return (
    <div className="hxp">
      <style
        dangerouslySetInnerHTML={{
          __html: sheetCss + toggleCss + userFlagsCss + ownCss,
        }}
      />
      <div className="col">
        <header className="masthead">
          <h1>Feature flags</h1>
        </header>

        <h2 className="kicker">
          <span>
            All features
            {!error && (
              <span className="aside num"> · {featureNames.length}</span>
            )}
          </span>
          <Link className="aside" href="/admin">
            ← Admin
          </Link>
        </h2>

        <p className="lede">
          What each feature is set to for everyone, and for the forecasters who
          are an exception to it.
        </p>

        {error ? (
          <p className="failed">{error}</p>
        ) : featureNames.length === 0 ? (
          <p className="lede">No feature flags are defined.</p>
        ) : (
          <div className="flags">
            <div className="flaghead">
              <span>Feature</span>
              <span>Default</span>
              <span>Per-user</span>
            </div>
            {featureNames.map((name) => (
              <FeatureRow
                key={name}
                featureName={name}
                flags={byName.get(name)!}
                onChange={onChange}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
