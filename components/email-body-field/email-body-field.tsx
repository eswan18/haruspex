"use client";

import { useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

import { Field } from "@/components/form-sheet/form-sheet";
import { renderEmailMarkdown } from "@/lib/email-markdown";

/**
 * The preview, set the way the email sets it: a section header opens with
 * room above it, and is a size up from the text rather than a page title.
 * Scoped under .hxf because that is the sheet the admin email forms are on,
 * and injected here because a sheet must inject every Css it uses.
 */
export const emailBodyFieldCss = `
.hxf .email-body .riso-seg { margin-bottom: 0.625rem; }
.hxf .email-body .preview {
  border: 1px solid var(--rule, currentColor);
  padding: 0.875rem 1rem;
  min-height: 18rem;
  font-size: 1rem;
  line-height: 1.625;
  overflow-wrap: anywhere;
}
.hxf .email-body .preview > :first-child { margin-top: 0; }
.hxf .email-body .preview p,
.hxf .email-body .preview ul,
.hxf .email-body .preview ol,
.hxf .email-body .preview blockquote,
.hxf .email-body .preview pre { margin: 0 0 1rem; }
.hxf .email-body .preview h1,
.hxf .email-body .preview h2 {
  font-size: 1.3125rem;
  line-height: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 2rem 0 0.625rem;
}
.hxf .email-body .preview h3,
.hxf .email-body .preview h4,
.hxf .email-body .preview h5,
.hxf .email-body .preview h6 {
  font-size: 1.0625rem;
  font-weight: 700;
  margin: 1.5rem 0 0.5rem;
}
.hxf .email-body .preview ul { list-style: disc; padding-left: 1.5rem; }
.hxf .email-body .preview ol { list-style: decimal; padding-left: 1.5rem; }
.hxf .email-body .preview li { margin: 0 0 0.375rem; }
.hxf .email-body .preview blockquote {
  border-left: 2px solid var(--rule, currentColor);
  padding-left: 1rem;
}
.hxf .email-body .preview code,
.hxf .email-body .preview pre {
  font-family: var(--font-roboto-mono), ui-monospace, monospace;
  font-size: 0.875rem;
  white-space: pre-wrap;
}
.hxf .email-body .preview hr {
  border: 0;
  border-top: 1px solid var(--rule, currentColor);
  margin: 1.5rem 0;
}
.hxf .email-body .preview .empty { color: var(--ink-muted, inherit); }
/* Ink, as the email prints links, rather than the app's red. */
.hxf .email-body .preview a.riso-md-link { color: inherit; }
`;

const HINT =
  "Markdown: **bold**, *italic*, ## Section, - list, [words](https://…). Line breaks are kept. No greeting is added; write your own.";

/**
 * The message box on the admin email forms, with a preview of the email.
 *
 * The textarea stays mounted while the preview shows, only hidden, so the
 * form's registration and the admin's cursor and undo history survive a look
 * at the preview.
 */
export function EmailBodyField({
  id,
  value,
  limit,
  error,
  registration,
  placeholder,
  initiallyPreviewing = false,
}: {
  id: string;
  value: string;
  limit: number;
  error?: string;
  registration: UseFormRegisterReturn;
  placeholder?: string;
  /** For stories: open on the preview rather than the textarea. */
  initiallyPreviewing?: boolean;
}) {
  const [previewing, setPreviewing] = useState(initiallyPreviewing);

  return (
    <div className="email-body">
      <style dangerouslySetInnerHTML={{ __html: emailBodyFieldCss }} />
      <Field
        label="Message"
        htmlFor={id}
        hint={HINT}
        count={[value.length, limit]}
        error={error}
      >
        <div className="riso-seg" role="group" aria-label="Message view">
          <button
            type="button"
            aria-pressed={!previewing}
            onClick={() => setPreviewing(false)}
          >
            Write
          </button>
          <button
            type="button"
            aria-pressed={previewing}
            onClick={() => setPreviewing(true)}
          >
            Preview
          </button>
        </div>
        <textarea
          id={id}
          rows={14}
          placeholder={placeholder}
          hidden={previewing}
          {...registration}
        />
        {previewing &&
          (value.trim() ? (
            <div
              className="preview"
              // Escaped by construction; see lib/email-markdown.ts.
              dangerouslySetInnerHTML={{ __html: renderEmailMarkdown(value) }}
            />
          ) : (
            <div className="preview">
              <p className="empty">Nothing to preview yet.</p>
            </div>
          ))}
      </Field>
    </div>
  );
}
