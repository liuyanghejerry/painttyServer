var util = require("util");
var _ = require('underscore');

function Router(options) {
  var defaultOptions = new function () {
    var self = this;
    self.name = '';
    self.log = false;
  };

  if (_.isUndefined(options)) {
    var options = {};
  }
  var op = _.defaults(options, defaultOptions);

  this.table = [];
}

Router.prototype.reg = function(rule, request, handler, enviroment) {
  var self = this;
  if ( !_.isString(rule) || !_.isString(request) || !_.isFunction(handler) ) {
    return;
  }

  var newRule = {
    'rule': rule, 
    'request': request, 
    'handler': handler,
    'enviroment': enviroment
  };
  self.table.push(newRule);
  return self;
}

Router.prototype.message = function(client, msg) {
  var self = this;
  if( !_.isObject(msg) && !_.isEmpty(msg) ) {
    return;
  }

  if (self.table.length < 1) {
    return;
  };

  var rules = _.pluck(self.table, 'rule');
  _.each(rules, function(ele, index, list) {
    if(_.has(msg, ele)) {
      var request = msg[ele];
      var entry = self.table[index];
      if (entry['request'] == request) {
        if (entry['enviroment']) {
          entry['handler'].call(entry['enviroment'], client, msg);
        }else{
          entry['handler'](client, msg);
        }
      }
    }
  });
  return self;
}

Router.prototype.clear = function() {
  this.table = [];
  return this;
}

module.exports = Router;
