"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { EmailBodyField } from "@/components/email-body-field/email-body-field";
import { Field, FormSheet, Refusal } from "@/components/form-sheet/form-sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  BODY_MAX_LENGTH,
  BUTTON_LABEL_MAX_LENGTH,
  BUTTON_LINK_MAX_LENGTH,
  resolveButtonLink,
  SUBJECT_MAX_LENGTH,
} from "@/lib/announcement";
import {
  getAnnouncementAudienceSize,
  sendAnnouncement,
} from "@/lib/db_actions/admin-announcement";

const formSchema = z
  .object({
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
    buttonLabel: z
      .string()
      .trim()
      .max(
        BUTTON_LABEL_MAX_LENGTH,
        `Keep the label under ${BUTTON_LABEL_MAX_LENGTH} characters`,
      ),
    buttonLink: z
      .string()
      .trim()
      .max(BUTTON_LINK_MAX_LENGTH, "That link is too long"),
  })
  // The server re-checks all of this; these only put the message beside the
  // field that needs fixing.
  .superRefine((values, ctx) => {
    if (values.buttonLabel && !values.buttonLink) {
      ctx.addIssue({
        code: "custom",
        path: ["buttonLink"],
        message: "A button needs a link too",
      });
    }
    if (values.buttonLink && !values.buttonLabel) {
      ctx.addIssue({
        code: "custom",
        path: ["buttonLabel"],
        message: "A button needs a label too",
      });
    }
    // Any https base will do: this asks only whether the text could be a link.
    if (
      values.buttonLink &&
      !resolveButtonLink(values.buttonLink, "https://haruspex.invalid")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["buttonLink"],
        message: "Use a path like /props/suggest, or an https:// URL",
      });
    }
  });

type Values = z.infer<typeof formSchema>;

/**
 * One message to every active user who has not turned announcements off.
 *
 * Two ways out. "Send a test to me" sends the same email to the admin alone,
 * straight away. "Send to everyone" asks first, with the number of people it
 * will reach, because it cannot be taken back.
 *
 * Like the one-to-one email, everything here says queued rather than sent:
 * comms does the delivering, and nothing here can see an inbox.
 */
export default function AnnouncementForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"test" | "count" | "send" | null>(null);
  const [confirming, setConfirming] = useState<Values | null>(null);
  const [audience, setAudience] = useState<number | null>(null);
  const { toast } = useToast();
  const router = useRouter();
  const subjectId = useId();
  const bodyId = useId();
  const labelId = useId();
  const linkId = useId();

  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: { subject: "", body: "", buttonLabel: "", buttonLink: "" },
  });

  const subject = form.watch("subject") ?? "";
  const body = form.watch("body") ?? "";
  const errors = form.formState.errors;

  async function send(values: Values, test: boolean) {
    setBusy(test ? "test" : "send");
    setError("");
    try {
      const result = await sendAnnouncement({ ...values, test });
      if (!result.success) {
        setError(result.error);
        return;
      }
      const { queued, failed } = result.data;
      if (test) {
        toast({
          title: "Test queued",
          description: "A copy is on its way to you.",
        });
        return;
      }
      toast({
        title: "Announcement queued",
        description:
          failed > 0
            ? `Queued for ${queued} ${queued === 1 ? "person" : "people"}; ${failed} could not be queued.`
            : `Queued for ${queued} ${queued === 1 ? "person" : "people"}.`,
        variant: failed > 0 ? "destructive" : "default",
      });
      setConfirming(null);
      router.push("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  /** Counts the audience fresh, so the number in the dialog is the real one. */
  async function confirm(values: Values) {
    setBusy("count");
    setError("");
    try {
      const result = await getAnnouncementAudienceSize();
      if (!result.success) {
        setError(result.error);
        return;
      }
      setAudience(result.data);
      setConfirming(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const people = audience === 1 ? "1 person" : `${audience ?? 0} people`;

  return (
    <FormSheet
      title="Send an announcement"
      kicker="Announcement"
      back={{ href: "/admin", label: "Admin" }}
      lede="Goes to every active user who has not turned announcements off. Each email carries a link to unsubscribe."
    >
      <form onSubmit={form.handleSubmit(confirm)}>
        <Field
          label="Subject"
          htmlFor={subjectId}
          count={[subject.length, SUBJECT_MAX_LENGTH]}
          error={errors.subject?.message}
        >
          <input
            id={subjectId}
            type="text"
            placeholder="Ideas for next season"
            {...form.register("subject")}
          />
        </Field>

        <EmailBodyField
          id={bodyId}
          value={body}
          limit={BODY_MAX_LENGTH}
          error={errors.body?.message}
          registration={form.register("body")}
          placeholder="Hello fellow forecasters,"
        />

        <Field
          label="Button label"
          htmlFor={labelId}
          optional
          hint="Fill in both the label and the link, or leave both empty."
          error={errors.buttonLabel?.message}
        >
          <input
            id={labelId}
            type="text"
            placeholder="Suggest a prop"
            {...form.register("buttonLabel")}
          />
        </Field>

        <Field
          label="Button link"
          htmlFor={linkId}
          optional
          hint="A path on Haruspex, like /props/suggest, or a full https:// URL."
          error={errors.buttonLink?.message}
        >
          <input
            id={linkId}
            type="text"
            placeholder="/props/suggest"
            {...form.register("buttonLink")}
          />
        </Field>

        {error && <Refusal message={error} />}

        <div className="submitrow">
          <button type="submit" className="submit" disabled={busy !== null}>
            {busy === "count" ? "Counting…" : "Send to everyone"}
            <span className="arrow" aria-hidden="true">
              →
            </span>
          </button>
          <button
            type="button"
            className="quit"
            disabled={busy !== null}
            onClick={form.handleSubmit((values) => send(values, true))}
          >
            {busy === "test" ? "Queueing…" : "Send a test to me"}
          </button>
        </div>
      </form>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && busy !== "send") setConfirming(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send to {people}?</DialogTitle>
            <DialogDescription>
              {audience === 0
                ? "Nobody would receive this: every active user has turned announcements off."
                : `“${confirming?.subject}” will be queued for ${people} at once. This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="hxf">
            <button
              type="button"
              className="quit"
              onClick={() => setConfirming(null)}
              disabled={busy === "send"}
            >
              Cancel
            </button>
            <button
              type="button"
              className="submit"
              onClick={() => confirming && send(confirming, false)}
              disabled={busy === "send" || audience === 0}
            >
              {busy === "send" ? "Queueing…" : "Send"}
              <span className="arrow" aria-hidden="true">
                →
              </span>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FormSheet>
  );
}
