# Bank statement extraction tool

Extract transaction rows from the provided bank statement PDF into normalized records.

- Return each transaction once, preserving its printed date, direction, amount, currency, counterparty, reference, and memo when present.
- Use `debit` for money leaving the account and `credit` for money entering it.
- Do not include account numbers, balances, customer profile data, or page headers as transactions.
- Do not invent missing fields. Use null for an absent counterparty, reference, or memo.
- Dates must use `YYYY-MM-DD`; amounts must be positive decimal strings without grouping separators or currency symbols.
- The output is draft data. A person reviews payment matches before they are confirmed.

The PDF is sent to OpenAI for extraction. Do not send it to any other provider.
