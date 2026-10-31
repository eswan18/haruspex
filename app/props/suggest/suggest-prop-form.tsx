"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Field, FormSheet, Refusal } from "@/components/form-sheet/form-sheet";
import { useToast } from "@/hooks/use-toast";
import { createSuggestedProp } from "@/lib/db_actions";
import {
  CLAIM_MAX_LENGTH,
  CLAIM_MIN_LENGTH,
  NOTES_MAX_LENGTH,
} from "@/lib/suggested-prop";
import { describeThrownError } from "@/lib/thrown-error";

const formSchema = z.object({
  // The server re-checks all of this (lib/suggested-prop.ts); here it is
  // only so the reader hears about it before sending.
  propText: z
    .string()
    .trim()
    .min(
      CLAIM_MIN_LENGTH,
      `Say a little more — at least ${CLAIM_MIN_LENGTH} characters`,
    )
    .max(
      CLAIM_MAX_LENGTH,
      `Keep the claim under ${CLAIM_MAX_LENGTH} characters`,
    ),
  notes: z
    .string()
    .trim()
    .max(
      NOTES_MAX_LENGTH,
      `Keep the notes under ${NOTES_MAX_LENGTH} characters`,
    )
    .optional(),
});

type Values = z.infer<typeof formSchema>;

export function SuggestPropForm() {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const claimId = useId();
  const notesId = useId();

  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: { propText: "", notes: "" },
  });

  const claim = form.watch("propText") ?? "";
  const notes = form.watch("notes") ?? "";

  async function onSubmit(values: Values) {
    setSaving(true);
    setError("");
    try {
      const result = await createSuggestedProp({
        prop: values.propText,
        notes: values.notes ?? null,
      });
      if (result.success) {
        form.reset({ propText: "", notes: "" });
        toast({
          title: "Suggestion sent",
          description: "An admin will look at it before it goes in a season.",
        });
      } else if ("validationErrors" in result && result.validationErrors) {
        // The server's check refused a field the form let through; say so on
        // the field itself, where the client-side errors appear.
        const { prop, notes } = result.validationErrors;
        if (prop?.[0]) {
          form.setError(
            "propText",
            { message: prop[0] },
            { shouldFocus: true },
          );
        }
        if (notes?.[0]) {
          form.setError(
            "notes",
            { message: notes[0] },
            { shouldFocus: !prop?.[0] },
          );
        }
        if (!prop?.[0] && !notes?.[0]) setError(result.error);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(describeThrownError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormSheet
      title="Suggest a prop"
      kicker="New suggestion"
      back={{ href: "/", label: "Home" }}
      lede="Propose something for a future season. An admin reviews every suggestion before it goes in."
    >
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Field
          label="The claim"
          htmlFor={claimId}
          hint="A statement that will turn out true or false. Markdown works."
          count={[claim.length, CLAIM_MAX_LENGTH]}
          error={form.formState.errors.propText?.message}
        >
          <textarea
            id={claimId}
            rows={3}
            placeholder="Bitcoin closes the year above $150,000."
            aria-invalid={!!form.formState.errors.propText}
            {...form.register("propText")}
          />
        </Field>

        <Field
          label="Notes"
          htmlFor={notesId}
          optional
          hint="How it should be settled, and anything a reader would need to judge it."
          count={[notes.length, NOTES_MAX_LENGTH]}
          error={form.formState.errors.notes?.message}
        >
          <textarea
            id={notesId}
            rows={3}
            placeholder="Settled on the closing price reported by Coinbase at 00:00 UTC on 1 January."
            aria-invalid={!!form.formState.errors.notes}
            {...form.register("notes")}
          />
        </Field>

        {error && <Refusal message={error} />}

        <div className="submitrow">
          <button type="submit" className="submit" disabled={saving}>
            {saving ? "Sending…" : "Send suggestion"}
            <span className="arrow" aria-hidden="true">
              →
            </span>
          </button>
        </div>
      </form>
    </FormSheet>
  );
}
