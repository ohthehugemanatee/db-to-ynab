# Deutsche Bank to YNAB

- Sync your [Deutsche Bank transactions](https://meine.deutsche-bank.de/trxm/db) to YNAB
- It includes pending transactions
- Deployable as a Cloud Function on GCP

## Usage

### Locally

Running the app, requires the following environment variables:

For DB:
- `BRANCH`: Branch number
- `ACCOUNT`: Account number
- `PIN`: PIN code

For YNAB:
- `USERNAME`: Account username
- `PASS`: Password
- `YNAB_ACCOUNT_TITLE`: Account title to sync the transactions into

`ENABLE_SCREENSHOTS`: for debugging

Then, you can run a local version by `yarn start` and visiting http://localhost:3000 for triggering the function.

### Cloud Functions
- Setup a new Cloud Function with:
  - 2GB RAM
  - HTTP Trigger
  - Node.js 8 Runtime
  - Function to execute: `doIt`
  - The required environment variables