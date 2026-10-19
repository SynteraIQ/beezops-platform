# GL coding recommendation tool

## Purpose

Recommend a client GL account for each invoice line. This is a suggestion tool; it does not post to an accounting system or approve its own recommendations.

## Model instructions

- Choose only an account included in the supplied client chart of accounts. Never invent an account code.
- Use the invoice line description and amount, supplier name, and the supplied account name and description as evidence.
- If no account is adequately supported, return a null account code and explain what is missing.
- Return one result for each supplied line index. Keep each rationale concise and cite the supplied line or account context.
- Do not infer client identity, tax treatment, or payment status from a service description.
- The user must approve or change every recommendation before it becomes an accepted coding decision.

## Privacy

Only send the supplier name, invoice line descriptions and amounts, and the selected client's GL codes and descriptions. Do not include Bill To names or addresses, account identifiers, or source-document bytes.
