var util = require('util');

exports.isNumber =  function(o) {
  return typeof o === 'number' && isFinite(o);
};

exports.isString = function(s) {
  return typeof s === 'string' || s instanceof String;
};

exports.isFunction = function(f) {
  return typeof f === 'function';
};

exports.isArray = function(a) {
  return util.isArray(a);
};

exports.isUndefined = function(o) {
  return typeof o === 'undefined';
};

exports.isBoolean = function(b) {
  return typeof b === 'boolean' || b instanceof Boolean;
};

exports.isObject = function(o) {
  return typeof o === 'object';
};