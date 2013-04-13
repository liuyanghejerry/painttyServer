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

Router.prototype.reg = function(rule, request, handler) {
	if ( !_.isString(rule) || !_.isString(requet) || !_.isFunction(handler) ) {
		return;
	};
	var newRule = {'rule': rule, 'request': request, 'handler': handler};
	this.table.push(newRule);
}

Router.prototype.message = function(msg) {
	var self = this;
	if( !_.isObject(msg) && !_.isEmpty(msg) ) {
		return;
	}

	var rules = _.pluck(self.table, 'rule');
	_.each(rules, function(ele, index, list) {
		if(_.has(msg, ele)) {
			var request = msg[ele];
			if (self.table[index]['request'] == request) {
				self.table[index]['handler'](msg);
			};
		}
	});
	
}

module.exports = Router;
