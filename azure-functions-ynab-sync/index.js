const app = require('../index.js')

module.exports = function (context, req) {
  await app.doIt(req, context.res);
  context.done();
}