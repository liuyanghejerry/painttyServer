var os = require('os');
var zlib = require('zlib');
var fs = require('fs');
var util = require("util");
var Buffers = require('buffers');
var _ = require('underscore');
var logger = require('tracer').dailyfile({root:'./logs'});

exports.qCompress = function (buffer, fn) {
  var buffers = new Buffers();
  var len = buffer.length;
  var len_array = new Buffer(4);
  len_array[3] = len & 0xFF;
  len_array[2] = (len & 0x0000FF00) >> 8;
  len_array[1] = (len & 0x00FF0000) >> 16;
  len_array[0] = len >> 24;
  
  zlib.deflate(buffer, function(err, result) {
    if(err) {
      logger.error(err);
      fn(result, err);
    }else{
      buffers.push(len_array);
      buffers.push(result);
      fn(buffers.toBuffer());
    }
  });
};

exports.qUncompress = function (buffer, fnc) {
  var resized = buffer.slice(4, buffer.length);
  zlib.unzip(resized, function(err, result) {
    if(err) {
      logger.error(err);
    }
    fnc(result, err);
  });
};

exports.jsonToString = function (j) {
  try {
    var str = JSON.stringify(j);
    return str;
  } 
  catch(e) {
    logger.error('Error in JSON', e);
    return '{}';
  }
};

exports.stringToJson = function (s) {
  try {
    var json = JSON.parse(s);
    return json;
  } 
  catch(e) {
    logger.error('Error in JSON', e);
    return {};
  }
};