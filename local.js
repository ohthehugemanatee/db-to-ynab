const express = require('express')

const index = require('./index')

const app = express()

app.get('/', index.doIt)
app.get('/authorized', index.authorized)

app.listen(3000, () => console.log('Visit http://localhost:3000 to trigger the action'))
