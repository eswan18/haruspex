"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { EmailBodyField } from "@/components/email-body-field/email-body-field";
import { Field, FormSheet, Refusal } from "@/components/form-sheet/form-sheet";
import { useToast } from "@/hooks/use-toast";
import { sendManualEmail } from "@/lib/db_actions/admin-email";
import { BODY_MAX_LENGTH, SUBJECT_MAX_LENGTH } from "@/lib/manual-email";
import { VUser } from "@/types/db_types";

const formSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(1, "A subject is required")
    .max(SUBJECT_MAX_LENGTH, `Keep the subject under ${SUBJECT_MAX_LENGTH} characters`),
  body: z
    .string()
    .trim()
    .min(1, "A message is required")
    .max(BODY_MAX_LENGTH, `Keep the message under ${BODY_MAX_LENGTH} characters`),
});

type Values = z.infer<typeof formSchema>;

/**
 * One hand-written email to one account.
 *
 * The wording throughout says queued rather than sent, and that is literal:
 * haruspex publishes the message and comms delivers it, so nothing here can
 * know whether it reached the inbox. Saying "Sent" would be a nicer sentence
 * and a false one.
 */
export default function SendEmailForm({ user }: { user: VUser }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const subjectId = useId();
  const bodyId = useId();

  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: { subject: "", body: "" },
  });

  const subject = form.watch("subject") ?? "";
  const body = form.watch("body") ?? "";

  async function onSubmit(values: Values) {
    setSaving(true);
    setError("");
    try {
      const result = await sendManualEmail({
        userId: user.id,
        subject: values.subject,
        body: values.body,
      });
      if (result.success) {
        toast({
          title: "Email queued",
          description: `Queued for ${result.data.email}.`,
        });
        router.push("/admin/users");
        router.refresh();
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
      title={`Email ${user.name}`}
      kicker="New message"
      back={{ href: "/admin/users", label: "Users" }}
      lede={`Goes to ${user.email}. They will not be able to tell it was written by hand rather than sent by the app.`}
    >
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Field
          label="Subject"
          htmlFor={subjectId}
          count={[subject.length, SUBJECT_MAX_LENGTH]}
          error={form.formState.errors.subject?.message}
        >
          <input
            id={subjectId}
            type="text"
            placeholder="About your account"
            {...form.register("subject")}
          />
        </Field>

        <EmailBodyField
          id={bodyId}
          value={body}
          limit={BODY_MAX_LENGTH}
          error={form.formState.errors.body?.message}
          registration={form.register("body")}
          placeholder="Write your message…"
        />

        {error && <Refusal message={error} />}

        <div className="submitrow">
          <button type="submit" className="submit" disabled={saving}>
            {saving ? "Queueing…" : "Queue email"}
            <span className="arrow" aria-hidden="true">
              →
            </span>
          </button>
        </div>
      </form>
    </FormSheet>
  );
}
