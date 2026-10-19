# Invoice extraction tool

## Purpose

Extract the readable information from one invoice PDF into the accounting canonical invoice shape. This is a callable tool that can be invoked by a workflow, an agent, or a human initiated action. It does not require an agent to run.

## Input

- `base64`: PDF bytes encoded as Base64.

## Output

- Canonical invoice fields, line items, and detailed tax breakdown.
- Field-level availability, confidence, evidence excerpt, and page when available.
- Validation issues for missing required values, malformed values, or arithmetic inconsistencies.
- Model key used for the request.

## Model instructions

- Extract only values readable in the document. Do not infer missing values.
- Mark each field `provided`, `not_present`, or `unreadable`. Use a non-empty value only for `provided` fields.
- Represent amounts and rates as decimal strings without currency symbols or percent signs. Represent a printed rate of `9%` as `9`.
- Use `YYYY-MM-DD` for dates and an ISO 4217 three-letter code for currency.
- For provided fields, include a short exact evidence excerpt and page number when available. Confidence must be between 0 and 1, or null.
- Preserve readable line items.
- Extract the Bill To name and address exactly as printed when present. Preserve the full address as one readable field; do not treat it as verified client identity or infer missing address components.
- Extract each printed tax row, including HSN/SAC, taxable amount, printed tax label, normalized tax type when clear, rate, and amount. Preserve the printed label separately from the normalized type.
- For GST invoices, preserve labels such as `CGST OUTPUT 9%` and `SGST OUTPUT 9%` exactly in `printedLabel`; normalize `taxType` to `CGST` or `SGST` only when the label makes the type clear. Capture IGST, UTGST, cess, and other printed tax components when present.
- Do not assume an invoice is governed by GST. Do not infer a tax type, rate, or amount that the document does not show clearly.
- Do not add subtotal or total rows as tax breakdown rows. Keep invoice-level subtotal, tax amount, and total amount as printed.
- Do not infer tax types, rates, or amounts. The invoice-level tax amount is the printed invoice tax total, not a model-calculated total.

## Runtime and ownership

The runtime prompt and structured output schema live beside this document in `index.ts` so the workflow bundler can include them without runtime filesystem access. Keep that prompt, schema, and this instruction document aligned when changing extraction behavior. Increment the prompt or schema version when its corresponding contract changes.

This tool performs extraction and deterministic validation only. Workflow orchestration, persistence, retry policy, and approval decisions belong to the caller.
