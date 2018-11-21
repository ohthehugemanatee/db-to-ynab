const express = require('express')

const index = require('./index')

const app = express()

app.get('/', index.doIt)
app.get('/test', index.testIt)

app.listen(3000, () => console.log('Visit http://localhost:3000 to trigger the action, /test to trigger a test run with dummy data'))
