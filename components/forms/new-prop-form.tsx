"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useId } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Field, FormSheet, Refusal } from "@/components/form-sheet/form-sheet";
import { OptionsEditor } from "@/components/forms/options-editor";
import {
  defaultOptionFields,
  propKindSchema,
  propOptionsSchema,
  refineKindOptions,
} from "@/components/forms/prop-form-schema";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { useServerAction } from "@/hooks/use-server-action";
import type { NewPropAudience } from "@/lib/competition-status";
import { createProp } from "@/lib/db_actions";
import {
  isChoiceKind,
  PROP_KIND_LABELS,
  PROP_KINDS,
  type PropKind,
} from "@/lib/prop-kind";
import type { Category } from "@/types/db_types";

const CLAIM_MAX = 300;
const NOTES_MAX = 1000;

const formSchema = z
  .object({
    text: z
      .string()
      .min(8, "Say a little more — at least 8 characters")
      .max(CLAIM_MAX, `Keep the claim under ${CLAIM_MAX} characters`),
    kind: propKindSchema,
    options: propOptionsSchema,
    notes: z
      .string()
      .max(NOTES_MAX, `Keep the notes under ${NOTES_MAX} characters`)
      .nullable()
      .transform((val) => (val === "" ? null : val)),
    category_id: z.number().nullable(),
    forecasts_due_date: z.date({ message: "A forecast deadline is required" }),
    resolution_due_date: z.date({ message: "A resolution date is required" }),
    notify_members: z.boolean(),
  })
  .refine((data) => data.forecasts_due_date > new Date(), {
    message: "The forecast deadline must be in the future",
    path: ["forecasts_due_date"],
  })
  .refine((data) => data.resolution_due_date > new Date(), {
    message: "The resolution date must be in the future",
    path: ["resolution_due_date"],
  })
  .refine((data) => data.resolution_due_date > data.forecasts_due_date, {
    message: "It has to resolve after forecasting closes",
    path: ["resolution_due_date"],
  })
  .superRefine(refineKindOptions);

type FormValues = z.infer<typeof formSchema>;

const ownCss = `
/* the tips are reference, not instruction: set small, in the second colour of
   the sheet's greys, under a rule of their own */
.hxp .tips { padding-top: 3rem; }
.hxp .tips ul { margin: 0.75rem 0 0; padding-left: 1.125rem; }
.hxp .tips li { color: var(--ink-muted); font-size: 0.875rem; padding-bottom: 0.25rem; }
`;

/**
 * Where the prop is going.
 *
 * A competition prop belongs to the season and to nobody; a personal one
 * belongs to its author and to no season. That single fact is the only thing
 * that differs between the two forms, so they are one form.
 *
 * `audience` is `newPropAudience` for the competition: who could be emailed
 * about the new prop, or null when nobody is, in which case the form does not
 * offer to.
 */
export type PropTarget =
  | {
      kind: "competition";
      id: number;
      name: string;
      audience: NewPropAudience | null;
    }
  | { kind: "personal" };

/** The checkbox's wording for each audience that can be told. */
const ANNOUNCE_LABELS: Record<NewPropAudience, string> = {
  members: "Email the members",
};

export function NewPropForm({
  target,
  categories,
  userId,
  initialText = "",
  initialNotes = null,
}: {
  target: PropTarget;
  categories: Category[];
  userId: number;
  /** Seeded when the form is opened from an accepted suggestion. */
  initialText?: string;
  initialNotes?: string | null;
}) {
  const router = useRouter();
  const optionsLabelId = useId();
  const textId = useId();
  const notesId = useId();
  const kindId = useId();
  const categoryId = useId();
  const announceId = useId();

  const audience = target.kind === "competition" ? target.audience : null;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      text: initialText,
      kind: "binary",
      // The kind select seeds these when the kind becomes a choice kind.
      options: [],
      notes: initialNotes,
      category_id: null,
      forecasts_due_date: undefined,
      resolution_due_date: undefined,
      // On by default: a prop added on its own is news. The author unticks it
      // when loading several at once, rather than sending a burst of mail.
      notify_members: true,
    },
  });

  const home =
    target.kind === "competition" ? `/competitions/${target.id}` : "/props";
  const create = useServerAction(createProp, {
    successMessage: "Prop created",
    onSuccess: () => router.push(home),
  });

  const kind = form.watch("kind");
  const text = form.watch("text") ?? "";
  const notes = form.watch("notes") ?? "";
  const errors = form.formState.errors;

  // `refineKindOptions` puts every option complaint on the `options` path, so
  // the messages belong to the list as a whole rather than to one row.
  const optionErrors = [
    errors.options?.message,
    errors.options?.root?.message,
  ].filter((m): m is string => Boolean(m));

  function onKindChange(next: PropKind) {
    form.setValue("kind", next);
    if (isChoiceKind(next)) {
      if (form.getValues("options").length === 0) {
        form.setValue("options", defaultOptionFields());
      }
    } else {
      form.setValue("options", []);
    }
    // Whatever the old options were, any complaint about them is now stale.
    form.clearErrors("options");
  }

  async function onSubmit(values: FormValues) {
    await create.execute({
      prop: {
        text: values.text,
        kind: values.kind,
        notes: values.notes,
        category_id: values.category_id,
        competition_id: target.kind === "competition" ? target.id : null,
        // A personal prop is owned by its author, which is what makes it
        // personal — and what lets that author resolve it later.
        user_id: target.kind === "personal" ? userId : null,
        forecasts_due_date: values.forecasts_due_date,
        resolution_due_date: values.resolution_due_date,
        created_by_user_id: userId,
      },
      options: isChoiceKind(values.kind)
        ? values.options.map((option) => option.text)
        : undefined,
      // The box is only shown when there is an audience; the server checks
      // again rather than trusting this.
      notifyMembers: audience !== null && values.notify_members,
    });
  }

  return (
    <FormSheet
      title={target.kind === "competition" ? target.name : "Your props"}
      kicker="New prop"
      back={{
        href: home,
        label: target.kind === "competition" ? "Overview" : "Your props",
      }}
      extraCss={ownCss}
    >
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Field
          label="The claim"
          htmlFor={textId}
          hint="A statement that will turn out true or false. Markdown works."
          count={[text.length, CLAIM_MAX]}
          error={errors.text?.message}
        >
          <textarea
            id={textId}
            rows={3}
            placeholder="Bitcoin closes the year above $150,000."
            {...form.register("text")}
          />
        </Field>

        <Field
          label="Kind"
          htmlFor={kindId}
          hint="A yes/no claim, one option of several, or any that apply."
        >
          <select
            id={kindId}
            className="pick"
            value={kind}
            onChange={(e) => onKindChange(e.target.value as PropKind)}
          >
            {PROP_KINDS.map((k) => (
              <option key={k} value={k}>
                {PROP_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>

        {isChoiceKind(kind) && (
          <Field
            label="Options"
            labelId={optionsLabelId}
            hint="Forecasters see these in the order listed here."
          >
            <OptionsEditor
              value={form.watch("options").map((o) => o.text)}
              onChange={(labels) =>
                form.setValue(
                  "options",
                  labels.map((t) => ({ text: t })),
                )
              }
              errors={optionErrors}
              ariaLabelledBy={optionsLabelId}
            />
          </Field>
        )}

        <Field
          label="Notes"
          htmlFor={notesId}
          optional
          hint="How it should be settled, and anything a reader needs to judge it."
          count={[notes.length, NOTES_MAX]}
          error={errors.notes?.message}
        >
          <textarea
            id={notesId}
            rows={3}
            placeholder="Settled on the closing price reported by Coinbase at 00:00 UTC on 1 January."
            {...form.register("notes")}
          />
        </Field>

        <Field label="Category" htmlFor={categoryId} optional>
          <select
            id={categoryId}
            className="pick"
            value={form.watch("category_id") ?? "null"}
            onChange={(e) =>
              form.setValue(
                "category_id",
                e.target.value === "null" ? null : Number(e.target.value),
              )
            }
          >
            <option value="null">None</option>
            {categories.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="pair">
          <Field
            label="Forecasts due"
            labelId={`${textId}-fd`}
            hint="After this, nobody can change their number."
            error={errors.forecasts_due_date?.message}
          >
            <div className="borrowed">
              <DateTimePicker
                value={form.watch("forecasts_due_date")}
                onChange={(d) => form.setValue("forecasts_due_date", d as Date)}
                timeZone="UTC"
                placeholder="When forecasts close"
              />
            </div>
          </Field>
          <Field
            label="Resolves"
            labelId={`${textId}-rd`}
            hint="When the answer should be known."
            error={errors.resolution_due_date?.message}
          >
            <div className="borrowed">
              <DateTimePicker
                value={form.watch("resolution_due_date")}
                onChange={(d) =>
                  form.setValue("resolution_due_date", d as Date)
                }
                timeZone="UTC"
                placeholder="When it settles"
              />
            </div>
          </Field>
        </div>

        {audience && (
          <Field label="Announce it" labelId={announceId}>
            <div className="choose" role="group" aria-labelledby={announceId}>
              <label htmlFor={`${announceId}-box`}>
                <input
                  type="checkbox"
                  id={`${announceId}-box`}
                  {...form.register("notify_members")}
                />
                <span>
                  <span className="who">{ANNOUNCE_LABELS[audience]}</span>
                  <span className="what">
                    {" "}
                    — each gets a link to forecast on it. Untick when adding
                    several at once.
                  </span>
                </span>
              </label>
            </div>
          </Field>
        )}

        {create.error && <Refusal message={create.error} />}

        <div className="submitrow">
          <button type="submit" className="submit" disabled={create.isLoading}>
            {create.isLoading ? "Creating…" : "Create prop"}
            <span className="arrow" aria-hidden="true">
              →
            </span>
          </button>
          <Link className="quit" href={home} aria-disabled={create.isLoading}>
            Cancel
          </Link>
        </div>

        <div className="tips">
          <span className="mono muted">What makes a good prop</span>
          <ul>
            <li>It can only turn out one way, and you will know which.</li>
            <li>Name the date, the number, or the source that settles it.</li>
            <li>Put the resolution criteria in the notes, not in your head.</li>
            <li>
              Close forecasting before the answer starts becoming obvious.
            </li>
          </ul>
        </div>
      </form>
    </FormSheet>
  );
}
