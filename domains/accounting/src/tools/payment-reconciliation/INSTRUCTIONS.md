# Payment reconciliation tool

Rank statement transactions that may pay one open client invoice.

- Use invoice number, amount, currency, invoice date, supplier, transaction date, counterparty, reference, and memo as evidence.
- A transaction is only a candidate. Never mark it paid or claim that payment is confirmed.
- Only return transaction IDs from the supplied candidates.
- Recommend an allocation no greater than the invoice balance or transaction's available amount.
- Explain the evidence and uncertainty. Return an empty candidate list if none is supported.
- Do not use a transaction with a different currency or a credit direction.

The selected client's structured statement rows and invoice fields are sent to OpenAI for matching. Do not send them to any other provider.
