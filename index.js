const Papa = require('papaparse')
const path = require('path')
const fs = require('fs')
const uuid = require('uuid/v4')
const mkdirp = require('mkdirp')
const ynabAPI = require('ynab')
const moment = require('moment')
var dbUser = {}

var ClientOAuth2 = require('client-oauth2')
const dbAuth = new ClientOAuth2({
  clientId: process.env.DB_CLIENT_ID,
  clientSecret: process.env.DB_CLIENT_SECRET,
  accessTokenUri: 'https://simulator-api.db.com/gw/oidc/token',
  authorizationUri: 'https://simulator-api.db.com/gw/oidc/authorize',
  redirectUri: 'https://cvert-dev.germany.vertesi.com/authorized',
  scopes: ['read_transactions', 'read_accounts', 'read_credit_cards_list_with_details', 'read_credit_card_transactions', 'offline_access']
}) 

const {
  BRANCH,
  ACCOUNT,
  PIN,
  ACCOUNT_ROW,
  ENABLE_SCREENSHOTS,
  YNAB_APIKEY,
  YNAB_BUDGET,
  YNAB_ACCOUNT,
  DB_CLIENT_ID,
  DB_CLIENT_SECRET,
  DB_API_ENABLED
} = process.env
class DBAPI {
  constructor(props) {
    this.clientId = props.clientId
    this.clientSecret = props.clientSecret
    this.dbAuth = props.dbAuth
    this.dbUser = props.dbUser
  }
  async getConfig() {
    const { Issuer } = require('openid-client')
    try {
      Issuer.discover('https://simulator-api.db.com/gw/oidc')
      .then(function (dbIssuer) {
        console.log('Discovered issuer %s %0', dbIssuer.issuer, dbIssuer.metadata)
      })
    } catch (error) {
      console.log(error)
    }
  }
  authorize = function(req, res) {
    var uri = dbAuth.code.getUri()
    res.redirect(uri)
  }

  renew = function(req, res) {
    dbAuth.code.getToken(req.originalUrl)
    .then(function (user) {
        // Refresh the current users access token.
        user.refresh().then(function (updatedUser) {
            console.log(updatedUser)
            dbUser = updatedUser
        })
        console.log("Successfully authorized!")
        res.status(200).send("Successfully authorized")
    })
  }
}

class YNAB {
  constructor(props) {
    this.ynabAPI = props.ynabAPI
    this.budgetTitle = props.ynabBudget
    this.accountTitle = props.ynabAccount
    this.transactions = []
  }

  async findBudget() {
    console.log('Listing budgets')
    const budgetsResponse = await this.ynabAPI.budgets.getBudgets()
    const budgets = budgetsResponse.data.budgets
    const budgetTitle = this.budgetTitle
    const targetBudget = budgets.find(budget => budget.name === budgetTitle)
    if (!targetBudget) {
      throw new Error('Target budget not found')
    }
    console.log(`Found target budget: ${targetBudget.name}`)
    this.targetBudgetId = targetBudget.id
  }

  async findAccount() {
    if (typeof this.targetBudgetId === 'undefined') {
      this.findBudget()
    }
    console.log('Listing Accounts')
    const accountsResponse = await this.ynabAPI.accounts.getAccounts(this.targetBudgetId)
    const accounts = accountsResponse.data.accounts
    const accountTitle = this.accountTitle
    const targetAccount = accounts.find(account => account.name === accountTitle)
    if (!targetAccount) {
      throw new Error('Target account not found.')
    }
    console.log(`Found target account: ${targetAccount.name}`)
    this.targetAccountId = targetAccount.id
  }

  async parseCsv(transactionFilePath) {
    // Parse CSV.
    if (!transactionFilePath) {
      throw new Error('Transactions CSV not found')
    }
    const csvData = fs.readFileSync(transactionFilePath, 'utf-8')
    const linesExceptFirstFive = csvData.split('\n').slice(4).join('\n')
    const parseResults = Papa.parse(linesExceptFirstFive, {
      header: true
    })
    let transactions = []
    // Build transactions for checking.
    const buildTransactions = (array, current) => {
      if (!current.Buchungstag || current.Buchungstag === 'Kontostand') {
        return array
      }
      try {
        const payee_name = function (row) {
          if (row['Beg�nstigter / Auftraggeber'].length > 0) {
            return row['Beg�nstigter / Auftraggeber'].substring(0, 49);
          }
          if (row.Verwendungszweck.indexOf('//') === -1) {
            return '';
          }
          return row.Verwendungszweck.split('//')[0].substring(0,49);
        };
        const transaction = {
          // Payee name can only be 100 chars long.
          payee_name: payee_name(current),
          // Date must be in ISO format, no time.
          date: moment(current.Buchungstag, 'DD.MM.YYYY').format('YYYY-MM-DD'),
          // Memo can only be 100 chars long.
          memo: current.Verwendungszweck.substring(0, 99),
          // Amount is in 'YNAB milliunits' - ie no decimals, *10.
          amount: (
            (+current.Soll.replace(/[,.]/g, ''))
            + (+current.Haben.replace(/[,.]/g, ''))
          ) * 10,
          cleared: 'cleared'
        }
        // Import ID. We'll figure out the last digit once the array is built.
        transaction.import_id = `YNAB:${transaction.amount}:${transaction.date}:`
        array.push(transaction)
        return array
      } catch (error) {
        console.dir(error)
        console.log('Problem building the transactions array')
      }
    }
    if (this.creditCard === 0) {
      transactions = parseResults.data.reduce(buildTransactions, [])
    }
    // Build transactions for credit.
    const buildCreditTransactions = (array, current) => {
      if (!current.Belegdatum || current.Belegdatum === 'Online-Saldo:') {
        return array
      }
      try {
        const transaction = {
          // Payee name can only be 50 chars long.
          payee_name: current.Verwendungszweck.substring(0, 49) || '',
          // Date must be in ISO format, no time.
          date: moment(current.Belegdatum, 'DD.MM.YYYY').format('YYYY-MM-DD'),
          // Memo can only be 100 chars long.
          memo: current.Verwendungszweck.substring(0, 99),
          // Amount is in 'YNAB milliunits' - ie no decimals, *10.
          amount: current.Betrag.replace(/[, .]/g, '') * 10,
          cleared: 'cleared'
        }
        // Import ID. We'll figure out the last digit once the array is built.
        transaction.import_id = `YNAB:${transaction.amount}:${transaction.date}:`
        array.push(transaction)
        return array
      } catch (error) {
        console.dir(error)
        console.log('Problem building the transactions array')
      }
    }
    if (this.creditCard === 1) {
      transactions = parseResults.data.reduce(buildCreditTransactions, [])
    }
    this.transactions = transactions
  }

  async addPendingTransactions(pendingTransactions) {
    if (pendingTransactions.length === 0) {
      return
    }
    const transactions = this.transactions
    // Append uncleared transactions.
    for (let i = 0, length = pendingTransactions.length; i < length; i += 1) {
      const current = pendingTransactions[i]
      const [date, memo, soll, haben] = current
      const transaction = {
        payee_name: '',
        // Date must be in ISO format, no time.
        date: moment(date, 'DD.MM.YYYY').format('YYYY-MM-DD'),
        // Memo can only be 100 chars long.
        memo: memo.substring(0, 99),
        // Amount is in 'YNAB milliunits' - ie no decimals, *10.
        amount: (
          (+soll.replace(/[,.]/g, ''))
          + (+haben.replace(/[,.]/g, ''))
        ) * 10,
        cleared: 'uncleared'
      }
      // Import ID. We'll figure out the last digit during submission.
      transaction.import_id = `YNAB:${transaction.amount}:${transaction.date}:`
      transactions.push(transaction)
    }
  }

  async submitTransactions() {
    const transactions = this.transactions
    if (transactions.length === 0) {
      console.log('No transactions to submit.')
      return
    }
    // Generate last digit of import_id, set account Id.
    for (let i = 0, length = transactions.length; i < length; i += 1) {
      const transaction = transactions[i]
      // Append the count of remaining transactions in the array with this import ID.
      const remainingTrans = transactions.filter(t => t.import_id === transaction.import_id).length
      transaction.import_id += remainingTrans
      // Set the static account_id value.
      transaction.account_id = this.targetAccountId
    }
    console.dir('Uploading transactions: ', transactions)
    // Create transactions
    const targetBudgetId = this.targetBudgetId
    const transResponse = await this.ynabAPI.transactions.createTransactions(targetBudgetId, { transactions })
    // Log a count of what was created.
    const duplicateCount = transResponse.data.duplicate_import_ids.length
    const createdTransactions = transResponse.data.transaction_ids.length
    const message = `Created ${createdTransactions}, ignored ${duplicateCount} duplicate transactions`
    console.log(message)
  }
}

exports.authorized = function (req, res) {
  new DBAPI({
    clientId: DB_CLIENT_ID,
    clientSecret: DB_CLIENT_SECRET,
    dbAuth: dbAuth,
    dbUser: dbUser
  }).renew(req, res)
}

exports.doIt = async (req, res) => {
  const dbAPI = new DBAPI({
    clientId: DB_CLIENT_ID,
    clientSecret: DB_CLIENT_SECRET,
    dbAuth: dbAuth,
    dbUser: dbUser
  })
  try {
    if (!dbUser.hasOwnProperty('accessToken')) {
      dbAPI.authorize(req, res)
    }
  } catch (error) {
  console.error(error)
  console.log('Error caught')
  res.status(500).send(error)
  }
  /**
  try {
    ynab.creditCard = db.creditCard
    await ynab.parseCsv(db.transactionFilePath)
    await ynab.addPendingTransactions(db.pendingTransactions)
   if (ynab.transactions.length > 0) {
      await ynab.findBudget()
      await ynab.findAccount()
      await ynab.submitTransactions()
    }
    res.status(200).send('Success')
  } catch (error) {
    console.error(error)
    console.log('Problem uploading transactions to YNAB')
    res.status(500).send(error)
  }*/
}
