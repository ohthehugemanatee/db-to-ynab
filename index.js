const puppeteer = require('puppeteer')
const Papa = require('papaparse')
const path = require('path')
const fs = require('fs')
const uuid = require('uuid/v4')
const mkdirp = require('mkdirp')
const expect = require('expect-puppeteer')
const sleep = require('util').promisify(setTimeout)
const ynabAPI = require('ynab')
const moment = require('moment')


const {
  BRANCH,
  ACCOUNT,
  PIN,
  ACCOUNT_ROW,
  ENABLE_SCREENSHOTS,
  YNAB_APIKEY,
  YNAB_BUDGET,
  YNAB_ACCOUNT
} = process.env

class Browser {
  constructor(props) {
    this.enableScreenshots = props.enableScreenshots
  }

  async setup() {
    this.browser = await await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
    this.page = await this.browser.newPage()
  }

  async newPage() {
    this.page.close()
    this.page = await this.browser.newPage()
  }

  async close() {
    this.browser.close()
  }

  async downloadFileFromSelector(selector) {
    await this.page.waitForSelector(selector)
    const downloadPath = path.resolve('/tmp', uuid())
    mkdirp(downloadPath)
    console.log('Downloading file to:', downloadPath)
    /* eslint-disable-next-line no-underscore-dangle */
    await this.page._client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath })
    await expect(this.page).toClick(selector)
    const filename = await this.waitForFileToDownload(downloadPath)
    return path.resolve(downloadPath, filename)
  }

  /* eslint-disable-next-line class-methods-use-this */
  async waitForFileToDownload(downloadPath) {
    console.log(`Waiting for file to be downloaded ${downloadPath}`)
    let filename
    while (!filename || filename.endsWith('.crdownload')) {
      [filename] = fs.readdirSync(downloadPath)
      await sleep(500) // eslint-disable-line no-await-in-loop
    }
    console.log('Download finished!')
    return filename
  }

  async screenshot(filename) {
    if (!this.enableScreenshots) {
      return
    }
    const screenshotPath = path.resolve('/tmp', filename)
    await this.page.screenshot({ path: screenshotPath })
    console.log(`Screenshot taken: ${screenshotPath}`)
  }
}

class DB extends Browser {
  constructor(props) {
    super(props)
    this.branch = props.branch
    this.account = props.account
    this.pin = props.pin
    this.accountRow = props.accountRow || 1
  }

  async login() {
    console.log('going to db')
    await this.page.goto('https://meine.deutsche-bank.de/trxm/db/')
    await this.page.type('#branch', this.branch)
    await this.page.type('#account', this.account)
    await this.page.type('#pin', this.pin)
    await this.page.click('.button.nextStep')
    console.log('logging in')
  }

  async goToAccount() {
    // Bump target row to account for the header.
    this.accountRow = parseInt(this.accountRow) + 1
    const buttonSelector = `#contentContainer > table > tbody > tr:nth-child(${this.accountRow}) > td:nth-child(1) > a`
    await this.page.waitForSelector(buttonSelector)
    await this.screenshot('intro.png')
    await this.page.click(buttonSelector)
    console.log('opening account')
    const pageTitle = await this.page.title()
    this.creditCard = 1
    if (pageTitle.indexOf('Kreditkartentransaktionen') === -1) {
      this.creditCard = 0
      await this.page.waitForSelector('#periodFixed')
      await this.page.click('#periodFixed')
      const refreshButtonSelector = '#contentContainer div#formId.formContainer form#accountTurnoversForm div.formAction input.button'
      await this.page.click(refreshButtonSelector)
    }
  }

  async getPendingTransactions() {
    if (this.creditCard === 1) {
      console.log('No pending transactions for credit cards')
      this.pendingTransactions = []
      return
    }
    console.log('Getting pending transactions')
    const grabTransactions = () => Promise.resolve(
      Array
        .from(document.querySelectorAll('[headers=pTentry]'))
        .map(p => p.parentNode)
        .map(tr => Array
          .from(tr.querySelectorAll('td'))
          .map(trr => trr.innerText)
        )
    )
    try {
      await this.page.waitForSelector('.subsequentL')
    } catch (error) {
      return
    }
    await this.page.hover('.subsequentL')
    await this.screenshot('extra.png')
    const transactions = await this.page.evaluate(grabTransactions)
    this.pendingTransactions = transactions
    if (this.pendingTransactions.length === 0) {
      console.log('no pending transactions. moving on..')
    }
  }

  async downloadTransactionFile() {
    const fileSelector = '#contentContainer > div.pageFunctions > ul > li.csv > a'
    this.transactionFilePath = await this.downloadFileFromSelector(fileSelector)
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

exports.doIt = async (req, res) => {
  const db = new DB({
    account: ACCOUNT,
    branch: BRANCH,
    pin: PIN,
    accountRow: ACCOUNT_ROW,
    enableScreenshots: ENABLE_SCREENSHOTS
  })
  const ynab = new YNAB({
    ynabAPI: new ynabAPI.API(YNAB_APIKEY),
    ynabBudget: YNAB_BUDGET,
    ynabAccount: YNAB_ACCOUNT
  })

  try {
    await db.setup()
    await db.login()
    await db.goToAccount()
    await db.downloadTransactionFile()
    await db.getPendingTransactions()
  } catch (error) {
    console.dir(error)
    console.log(db.page.content())
    console.log('Problem downloading transactions from DB')
    res.status(500).send(error)
  }
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
  }
}
