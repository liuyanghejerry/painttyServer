var os = require('os');
var zlib = require('zlib');
var fs = require('fs');
var util = require("util");
var Buffers = require('buffers');
var _ = require('underscore');

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
			console.log(err);
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
			console.log(err);
		}
		fnc(result, err);
	});
};

exports.log = function (content, filename, level) {
	// WARNNING: filename is vulnerable
	if(!content) {
		return;
	}
	if(!filename) {
		var filename = './logs/main.log';
	}
	if(!level) {
		var level = 'info';
	}
	
	/*
	fs.appendFile(filename, function() {
		var readable = _.isObject(content)?util.inspect(content, true, 3):content.valueOf();
		return level+' - '+(new Date()).toISOString()+' - '+readable+os.EOL;
	}(), function (err) {
	  if (err) throw err;
	});
	*/
	var readable = _.isObject(content)?util.inspect(content, true, 3):content.valueOf();
	console.log( level+' - '+(new Date()).toISOString()+' - '+readable+os.EOL );
};
