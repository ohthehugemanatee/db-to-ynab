const puppeteer = require('puppeteer')
const Papa = require('papaparse')
const path = require('path')
const fs = require('fs')
const uuid = require('uuid/v4')
const mkdirp = require('mkdirp')
const expect = require('expect-puppeteer')
const sleep = require('util').promisify(setTimeout)
const writeFile = require('util').promisify(fs.writeFile)
const appendFile = require('util').promisify(fs.appendFile)
const convertCSV = require('./convertCSV')
const ynabAPI = require("ynab");
const moment = require('moment');


const {
  BRANCH,
  ACCOUNT,
  PIN,
  USERNAME,
  PASS,
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
    const buttonSelector = '#contentContainer > table > tbody > tr:nth-child(2) > td:nth-child(1) > a'
    await this.page.waitForSelector(buttonSelector)
    await this.screenshot('intro.png')
    await this.page.click(buttonSelector)
    console.log('opening account')
  }

  async downloadPendingTransactions() {
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
      console.log('no pending transactions. moving on..')
      return
    }
    await this.page.hover('.subsequentL')
    await this.screenshot('extra.png')
    const transactions = await this.page.evaluate(grabTransactions)
    this.pendingTransactionsPath = path.resolve('/tmp', `transactions-${uuid()}.json`)
    await writeFile(this.pendingTransactionsPath, JSON.stringify(transactions), 'utf8')
    await this.screenshot('transactions.png')
  }

  async appendPendingTransactions() {
    if (!this.pendingTransactionsPath) {
      return
    }
    /* eslint-disable-next-line import/no-dynamic-require,global-require */
    const pendingTransactions = require(this.pendingTransactionsPath)
    if (!pendingTransactions.length) {
      return
    }
    const convertedTransactions = pendingTransactions.reduce((converted, transaction) => {
      const [date, memo, soll, haben] = transaction
      converted.push([date, '', memo, soll.replace('-', ''), haben])
      return converted
    }, [])
    const convertedTransactionsCSV = Papa.unparse(convertedTransactions, { quotes: true, newline: '\n' })
    await appendFile(this.convertedCSVPath, `\n${convertedTransactionsCSV}`, 'utf8')
  }

  async downloadTransactionFile() {
    const fileSelector = '#contentContainer > div.pageFunctions > ul > li.csv > a'
    this.transactionFilePath = await this.downloadFileFromSelector(fileSelector)
  }

  async convertTransactionFile() {
    const convertedCSV = await convertCSV(this.transactionFilePath)
    this.convertedCSVPath = path.resolve('/tmp', `converted-${uuid()}.csv`)
    await writeFile(this.convertedCSVPath, convertedCSV, 'utf8')
  }
}

class YNAB extends Browser {
  constructor(props) {
    super(props)
    this.username = props.username
    this.pass = props.pass
    this.ynabAccountTitle = props.ynabAccountTitle
  }

  async login() {
    console.log('go to ynab')
    await this.page.goto('https://app.youneedabudget.com/users/login', { waitUntil: 'networkidle2' })
    await this.page.waitForSelector('#login-username')
    await this.page.type('#login-username', this.username)
    await this.page.type('#login-password', this.pass)
    await this.page.click('button.button-primary')
    console.log('logging in')
  }

  async goToAccount() {
    console.log('opening account')
    await this.page.waitForSelector('div.nav-accounts')
    await this.page.waitForSelector(`.nav-account-name.user-data[title="${this.ynabAccountTitle}"]`)
    await this.page.click(`.nav-account-name.user-data[title="${this.ynabAccountTitle}"]`)
    await this.screenshot('ynab-account.png')
  }

  async uploadCSV(csvPath) {
    console.log('uploading csv')
    await this.page.waitForSelector('.accounts-toolbar-file-import-transactions')
    await this.page.click('.accounts-toolbar-file-import-transactions')
    await this.page.waitForSelector('.file-picker')
    await this.page.click('.file-picker')
    const input = await this.page.$('input[type="file"]')
    await input.uploadFile(csvPath)
    await this.page.waitForSelector('.modal-actions-right button.button-primary')
    await this.screenshot('ynab2.png')
    await this.page.click('.modal-actions-right button.button-primary')
    await this.screenshot('ynab3.png')
    console.log('CSV uploaded!')
  }
}

exports.doIt = async (req, res) => {
  const db = new DB({
    account: ACCOUNT,
    branch: BRANCH,
    pin: PIN,
    enableScreenshots: ENABLE_SCREENSHOTS
  })
  const ynab = new YNAB({
    username: USERNAME,
    pass: PASS,
    ynabAccountTitle: YNAB_ACCOUNT_TITLE,
    enableScreenshots: ENABLE_SCREENSHOTS
  })
  try {
    await db.setup()
    await db.login()
    await db.goToAccount()
    await db.downloadTransactionFile()
    await db.downloadPendingTransactions()
    await db.appendPendingTransactions()
    await ynab.setup()
    await ynab.login()
    await ynab.goToAccount()
    await ynab.uploadCSV(db.convertedCSVPath)
  } catch (error) {
    console.error(error)
    res.status(500).send(error)
  }

  res.status(200).send('Success')
}

exports.doItApi = async (req, res) => {
  const db = new DB({
    account: ACCOUNT,
    branch: BRANCH,
    pin: PIN,
    enableScreenshots: ENABLE_SCREENSHOTS
  })
  const ynab = new ynabAPI.API(YNAB_APIKEY)

  try {
    await db.setup()
    await db.login()
    await db.goToAccount()
    await db.downloadTransactionFile()
    console.log("Listing budgets")
    const budgetsResponse = await ynab.budgets.getBudgets()
    const budgets = budgetsResponse.data.budgets
    let targetBudget = budgets.find(function (budget) {
      return budget.name === YNAB_BUDGET
    });
    if (!targetBudget) {
      console.log("Target budget not found.")
      return
    }
    console.log(`Found target budget: ${targetBudget.name}`)
    let targetBudgetId = targetBudget.id

    console.log("Listing Accounts")
    const accountsResponse = await ynab.accounts.getAccounts(targetBudgetId)
    const accounts = accountsResponse.data.accounts
    let targetAccount = accounts.find(function (account) {
      return account.name === YNAB_ACCOUNT
    });
    if (!targetAccount) {
      console.log("Target account not found.")
      return
    }
    console.log(`Found target account: ${targetAccount.name}`)
    let targetAccountId = targetAccount.id
    // Parse CSV.
    const transactionFilePath = db.transactionFilePath
    console.log("Transaction file path = ", transactionFilePath)
    if (!transactionFilePath) {
      reject(new Error('Transactions CSV not found'))
    }
    const csvData = fs.readFileSync(transactionFilePath, 'utf-8')
    const linesExceptFirstFive = csvData.split('\n').slice(4).join('\n')
    const buildTransactions = (array, current) => {
      if (!current.Buchungstag || current.Buchungstag === "Kontostand") {
        return array
      }
      try {
        const transaction = {
          account_id: targetAccountId,
          payee_name: current['Beg�nstigter / Auftraggeber'] || '',
          // Date must be in ISO format, no time.
          date: moment(current.Buchungstag, 'DD.MM.YYYY').format('YYYY-MM-DD'),
          // Memo can only be 100 chars long.
          memo: current.Verwendungszweck.substring(0, 99),
          // Amount is in "YNAB milliunits" - ie no decimals.
          amount: (+current.Soll.replace(/[,.]/g, '')) + (+current.Haben.replace(/[,.]/g, '')),
          cleared: "cleared"
        }
        // Import ID. We'll figure out the last digit once the array is built.
        transaction.import_id = 'YNAB:' + transaction.amount + ':' + transaction.date + ':'
        array.push(transaction)
        return array
      } catch (error) {
        console.dir(error)
        console.log("Problem building the transactions array")
      }
    }
		const parseResults = Papa.parse(linesExceptFirstFive, {
      header: true
    });
    const transactions = parseResults.data.reduce(buildTransactions, [])
    // Generate import_id for transactions.
    for (var i=0, length=transactions.length; i<length; i++) {
      transaction = transactions[i]
      // Append the count of remaining transactions in the array with this import ID.
      transaction.import_id += transactions.filter(t => t.import_id === transaction.import_id).length
    }
    console.dir("Uploading transactions: ", transactions)
    // Create transactions
    const transactionsResponse = await ynab.transactions.createTransactions(targetBudgetId, { transactions })
    // Log a count of what was created.
    const duplicateCount = transactionsResponse.data.duplicate_import_ids.length
    const createdTransactions = transactionsResponse.data.transaction_ids.length
    const message = "Created " + createdTransactions + ", ignored " + duplicateCount + " duplicate transactions"
    console.log(message)
 } catch (error) {
    console.error(error)
    res.status(500).send(error)
  }

  res.status(200).send('Success')
}
