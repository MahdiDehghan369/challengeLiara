# Liara billing API

## GET `https://api.liara.ir/v1/billing` — financial information
The endpoint returns:
- Credit balance (**in Toman**)
- Account type (individual / legal entity)
- The threshold below which a low-credit notification is sent
- Whether the user-configured minimum-credit alert is enabled (otherwise the system decides)
- Time of the last low-credit notification

Example:
```bash
curl --request GET \
  --url https://api.liara.ir/v1/billing \
  --header "Authorization: Bearer TOKEN"
```

**NOT PROVIDED:** the exact JSON field names. Capture a real response (redacted) into `fixtures/` and map them to `{balance, accountType, minCreditThreshold, alertEnabled, lastNotifiedAt}`. Full schema: `https://developers.liara.ir/spec/billing.yaml`.

Not available via API (human step): charging the account.
