var util = require('util');

exports = {
  isNumber: function(o) {
      return typeof o === 'number' && isFinite(o);
  },
  isString: function(s) {
    return typeof s === 'string' || s instanceof String;
  },
  isFunction: function(f) {
    return typeof f === 'function';
  },
  isArray: function(a) {
    return util.isArray(a);
  }
}