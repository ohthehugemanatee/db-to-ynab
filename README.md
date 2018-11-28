# Deutsche Bank to YNAB

- Sync your [Deutsche Bank transactions](https://meine.deutsche-bank.de/trxm/db) to YNAB
- It includes pending transactions
- Deployable as a Cloud Function on GCP

## Description

It uses a headless browser to:

- Login to DB
- Download the CSV of the transactions
- Grab the pending transactions from the page
- Send the transactions to YNAB using the API.

## Usage

### Locally

Running the app, requires the following environment variables:

For DB:
- `BRANCH`: Branch number
- `ACCOUNT`: Account number
- `PIN`: PIN code

For YNAB:
- `YNAB_APIKEY`: YNAB "Personal access token". [Here's how to get one](https://api.youneedabudget.com/#personal-access-tokens).
- `YNAB_BUDGET`: Budget title to sync the transactions into
- `YNAB_ACCOUNT`: Account title to sync the transactions into

`ENABLE_SCREENSHOTS`: for debugging the headless browser.

Then, you can run a local version by `yarn start-dev` and visiting http://localhost:3000 for triggering the function.

### Cloud Functions
- Setup a new Cloud Function with:
  - 2GB RAM
  - HTTP Trigger
  - Node.js 8 Runtime
  - Function to execute: `doIt`
  - The required environment variables
- Setup a cron job or a health check service to trigger the function periodically
