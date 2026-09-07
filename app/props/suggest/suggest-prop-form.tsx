"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Field, FormSheet, Refusal } from "@/components/form-sheet/form-sheet";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useToast } from "@/hooks/use-toast";
import { createSuggestedProp } from "@/lib/db_actions";

const CLAIM_MAX = 500;
const NOTES_MAX = 500;

const formSchema = z.object({
  propText: z
    .string()
    .min(8, "Say a little more — at least 8 characters")
    .max(CLAIM_MAX, `Keep the claim under ${CLAIM_MAX} characters`),
  notes: z
    .string()
    .max(NOTES_MAX, `Keep the notes under ${NOTES_MAX} characters`)
    .optional(),
});

type Values = z.infer<typeof formSchema>;

export function SuggestPropForm() {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const claimId = useId();
  const notesId = useId();

  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: { propText: "", notes: "" },
  });

  const claim = form.watch("propText") ?? "";
  const notes = form.watch("notes") ?? "";

  async function onSubmit(values: Values) {
    if (!user) return;
    setSaving(true);
    setError("");
    try {
      const result = await createSuggestedProp({
        prop: {
          prop: values.propText,
          // An empty box is an absent note, not an empty one.
          notes: values.notes?.trim() ? values.notes : null,
          suggester_user_id: user.id,
        },
      });
      if (result.success) {
        form.reset({ propText: "", notes: "" });
        toast({
          title: "Suggestion sent",
          description: "An admin will look at it before it goes in a season.",
        });
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
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
          count={[claim.length, CLAIM_MAX]}
          error={form.formState.errors.propText?.message}
        >
          <textarea
            id={claimId}
            rows={3}
            placeholder="Bitcoin closes the year above $150,000."
            {...form.register("propText")}
          />
        </Field>

        <Field
          label="Notes"
          htmlFor={notesId}
          optional
          hint="How it should be settled, and anything a reader would need to judge it."
          count={[notes.length, NOTES_MAX]}
          error={form.formState.errors.notes?.message}
        >
          <textarea
            id={notesId}
            rows={3}
            placeholder="Settled on the closing price reported by Coinbase at 00:00 UTC on 1 January."
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
