const express = require('express')

const index = require('./index')

const app = express()

var ClientOAuth2 = require('client-oauth2')
const clientId = process.env.DB_CLIENT_ID
const clientSecret = process.env.DB_CLIENT_SECRET
var dbAuth = new ClientOAuth2({
  clientId: clientId,
  clientSecret: clientSecret,
  accessTokenUri: 'https://simulator-api.db.com/gw/oidc/token',
  authorizationUri: 'https://simulator-api.db.com/gw/oidc/authorize',
  redirectUri: 'https://cvert-dev.germany.vertesi.com/authorized',
  scopes: ['read_transactions', 'read_accounts', 'read_credit_cards_list_with_details', 'read_credit_card_transactions']
})

app.get('/authorize', function (req, res) {
    var uri = dbAuth.code.getUri()
   
    res.redirect(uri)
  })
   
  app.get('/auth/github/callback', function (req, res) {
    
  })

app.get('/', index.doIt)
app.get('/authorized', function (req, res) {
    dbAuth.code.getToken(req.originalUrl)
    .then(function (user) {
        console.log(user)
        // Refresh the current users access token.
        user.refresh().then(function (updatedUser) {
            console.log(updatedUser !== user) //=> true
            console.log(updatedUser.accessToken)
        })
        console.log("Success!")
        // Sign API requests on behalf of the current user.
        /*user.sign({
            method: 'get',
            url: 'http://example.com'
        }) */
        
        // We should store the token into a database.
        return res.send(user.accessToken)
    })
})

app.listen(3000, () => console.log('Visit http://localhost:3000 to trigger the action'))
