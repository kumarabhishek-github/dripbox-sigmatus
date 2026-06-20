---
name: email-template-writer
description: >
  Write a human-sounding Jinja2 HTML email template for dripbox.
  Applies an embedded humanizer ruleset to strip AI writing patterns before
  generating the template. Outputs a ready-to-use .html file in
  backend/templates/. Use whenever a new email template is needed — warm-up,
  outreach, follow-up, event invite, or anything else.
allowed-tools:
  - Read
  - Write
  - AskUserQuestion
---

# Email Template Writer

You write email templates for dripbox. Templates are
Jinja2 HTML files saved to `backend/templates/`. Every template must sound like
a real person wrote it — not a language model. This skill embeds the rules for
that and walks you through applying them.

---

## Step 1 — Gather the brief

Before writing anything, collect the following. If the user provided them
already, skip straight to Step 2.

Ask (as a single AskUserQuestion with up to 4 questions at once):

1. **Content / goal** — What should the email say? What action do you want the
   reader to take?
2. **Sender name** — Who is signing it? (e.g. "Alex", "The team")
3. **Tone** — one of:
   - *casual* — friends, family, warm-up emails, informal asks
   - *warm-professional* — professionals, existing relationships
   - *direct* — cold outreach, first-contact sales
4. **CTA button?** — yes or no. If yes: button label + URL.
5. **Filename** — what to call the template file (no `.html`, no spaces,
   snake_case). Example: `warmup`.

---

## Step 2 — Draft the prose

Write the email body copy. Apply every rule below before putting a single word
on the page.

### Humanizer rules (must apply all)

**Vocabulary — ban these words outright:**
pivotal, testament, vibrant, rich (figurative), profound, underscores,
highlights (verb), showcasing, fostering, cultivating, encompassing, tapestry,
landscape (abstract), groundbreaking, renowned, breathtaking, nestled,
in the heart of, enduring, crucial, delve, interplay, intricate/intricacies,
Additionally (sentence-opener), align with, garner, valuable (vague).

**Sentence-level fixes:**
- Use *is/are/has*. Never "serves as", "stands as", "functions as",
  "represents", "marks a shift".
- Drop present-participle tail phrases: "…underscoring its importance",
  "…highlighting the interplay", "…reflecting broader trends". Say the thing
  directly or cut it.
- No em dashes. Ever. Replace with a comma, period, or colon.
- No rule of three. If you have three parallel items, cut to two or write them
  as a sentence.
- No negative parallelism: "It's not just X; it's Y." Say what it is.
- No "Not only X but also Y."

**Structure:**
- No formulaic conclusions: "exciting times lie ahead", "the future looks
  bright", "this is a major step forward".
- No vague attributions: "experts say", "industry observers note". Cite
  something real or drop it.
- No filler: "In order to" → "To". "Due to the fact that" → "Because".
  "At this point in time" → "Now". "It is important to note that" → cut.
- No chatbot artifacts: "Great question!", "I hope this helps!", "Let me know
  if you'd like more."

**Voice:**
- Vary sentence length. Short ones. Then longer ones that take their time.
- Use "I" or "we" when it fits — it signals a real person.
- Be specific. "A quick reply works" beats "your engagement is appreciated".
- Let a tiny bit of personality in. Not forced. Just not sterile.

**Casual tone extras** (for friends/family emails):
- Contractions are fine (we're, can you, it's).
- One well-placed emoji is okay. Not in bullet points, not as decoration.
- First name greeting without "Dear".

**Warm-professional tone extras:**
- Respect their time — keep it short.
- One concrete claim or number if possible.
- No hype words.

**Direct/cold tone extras:**
- Open with a specific observation, not a compliment.
- Lead with value, not about us.

---

## Step 3 — Self-audit

After writing the draft prose, do this explicitly in your reasoning:

> *"What makes the below so obviously AI-generated?"*

List the remaining tells (aim for 3–5 bullets). Then revise the draft to fix
each one. Show the final revised prose.

---

## Step 4 — Generate the HTML template

Wrap the final prose in the standard card layout below. Fill in the
content. Do not add any CSS beyond what is shown. Do not use external
stylesheets — email clients strip them.

**Required Jinja2 fields** (always include both):
- `{{ name }}` — recipient display name, used in the greeting
- `{{ unsubscribe_keyword }}` — injected from env, default "unsubscribe"

**Optional fields**: any merge field the campaign config will supply.

### HTML scaffold

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title><!-- short page title --></title>
  </head>
  <body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a202c;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f8fa;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">

            <!-- HEADER (optional — remove or set your brand name/color) -->
            <tr>
              <td style="padding:28px 40px 16px 40px;border-bottom:1px solid #edf2f7;">
                <div style="font-size:20px;font-weight:600;color:#4f46e5;letter-spacing:-0.2px;"><!-- Your brand --></div>
              </td>
            </tr>

            <!-- BODY -->
            <tr>
              <td style="padding:32px 40px 24px 40px;">

                <!-- greeting -->
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#2d3748;">
                  Hi {{ name }},
                </p>

                <!-- body paragraphs — one <p> per paragraph -->
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#2d3748;">
                  <!-- paragraph 1 -->
                </p>

                <!-- numbered list (only if needed — remove whole block if not) -->
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px 0;">
                  <tr>
                    <td style="width:32px;vertical-align:top;padding-top:2px;">
                      <div style="width:24px;height:24px;border-radius:50%;background:#4f46e5;color:#ffffff;font-size:13px;font-weight:600;text-align:center;line-height:24px;">1</div>
                    </td>
                    <td style="padding-left:10px;font-size:15px;line-height:1.6;color:#2d3748;">
                      <!-- item 1 -->
                    </td>
                  </tr>
                  <tr><td colspan="2" style="height:12px;"></td></tr>
                  <tr>
                    <td style="width:32px;vertical-align:top;padding-top:2px;">
                      <div style="width:24px;height:24px;border-radius:50%;background:#4f46e5;color:#ffffff;font-size:13px;font-weight:600;text-align:center;line-height:24px;">2</div>
                    </td>
                    <td style="padding-left:10px;font-size:15px;line-height:1.6;color:#2d3748;">
                      <!-- item 2 -->
                    </td>
                  </tr>
                </table>

                <!-- CTA button (remove if no CTA) -->
                <p style="margin:0 0 24px 0;">
                  <a href="<!-- URL -->" style="background:#4f46e5;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-size:15px;font-weight:500;">
                    <!-- Button label -->
                  </a>
                </p>

                <!-- sign-off -->
                <p style="margin:0;font-size:15px;line-height:1.6;color:#2d3748;">
                  <!-- sign-off line, e.g.: Thanks,<br>Alex -->
                </p>

              </td>
            </tr>

            <!-- FOOTER -->
            <tr>
              <td style="padding:16px 40px 28px 40px;border-top:1px solid #edf2f7;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#a0aec0;">
                  If you'd rather not hear from us, just reply with "{{ unsubscribe_keyword }}" and we'll stop.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

Remove any block you don't use (numbered list, CTA button). Don't leave empty
HTML scaffolding in place.

---

## Step 5 — Write the file and report

1. Write the completed HTML to `backend/templates/<filename>.html`
   (relative to the repo root).

2. Report back:
   - File path written
   - Suggested email subject line (plain text, no Jinja2 needed unless personalisation is wanted)
   - One-line summary of what the template does

---

## Reference — existing templates

| File | Tone | Purpose |
|------|------|---------|
| `intro.html` | direct | Cold intro / first contact |
| `followup.html` | direct | Follow-up step |
| `breakup.html` | direct | Final "break-up" step |
| `example_welcome.html` | generic | Minimal example |

Read any of these with the Read tool for style reference before generating.

---

## Quick reference — humanizer patterns cheat sheet

| AI pattern | Fix |
|-----------|-----|
| "serves as a testament to" | "is" |
| "underscoring its importance" | cut it |
| "in today's evolving landscape" | cut it |
| "Not only X, but also Y" | "X. Y." |
| "Additionally, …" (opener) | rewrite the sentence |
| "This is crucial/pivotal" | say why specifically |
| "Industry experts note" | cite someone real or cut |
| "I hope this helps!" | cut |
| "Going forward, …" | "From now on, …" or rewrite |
| Three-item list of equals | two items, or a sentence |
| Em dash (anywhere) | comma, period, or colon — never use em dashes |
| Bold headers in bullet points | plain text or prose |
