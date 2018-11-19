const fs = require('fs')
const Papa = require('papaparse')

const convertCSV = fileName => new Promise((resolve, reject) => {
  if (!fileName) {
    reject(new Error('Please pass the csv filename'))
  }

  const csvData = fs.readFileSync(fileName, 'utf-8')
  const linesExceptFirstFive = csvData.split('\n').slice(4).join('\n')

  const buildCSV = (array, current) => {
    try {
      const row = {
        Date: current.Buchungstag,
        Payee: current['Beg�nstigter / Auftraggeber'],
        Memo: current.Verwendungszweck,
        Outflow: current.Soll.replace('-', ''),
        Inflow: current.Haben
      }
      array.push(row)
    } catch (error) {
      // do natha
    }
    return array
  }

  const parseResults = (results) => {
    const lines = results.data
    const finalCSV = lines.reduce(buildCSV, [])
    resolve(Papa.unparse(finalCSV, { quotes: true, newline: '\n' }))
  }

  const csv = Papa.parse(linesExceptFirstFive, {
    header: true,
    complete: parseResults
  })
  return csv
})

module.exports = convertCSV
