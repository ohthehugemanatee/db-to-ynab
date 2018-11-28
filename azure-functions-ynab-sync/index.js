const app = require('../index.js')

module.exports = async (context, req) => {
  await app.doIt(req, context.res)
  context.done()
}