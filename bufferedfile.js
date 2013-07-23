var os = require('os');
var events = require('events');
var fs = require('fs');
var util = require("util");
var Buffers = require('buffers');
var _ = require('underscore');
var async = require('async');
var common = require('./common.js');
var logger = common.logger;
// var globalConf = common.globalConf;

function cycledWrite(bufferedfile) {
  bufferedfile.writeToDisk();
}

function openFile(bufferedfile, done){
  fs.open(bufferedfile.op.fileName, 'a+', function(err, fd){
    if (err) {
      logger.error('Error while open file', bufferedfile.op.fileName,
       ' in BufferedFile: ', err);
      done(err);
    } else {
      bufferedfile.fd = fd;
      done();
    }
  });
}

function BufferedFile(options) {
  events.EventEmitter.call(this);
  
  var defaultOptions = {
    fileName: 'tmp.tmp',
    writeCycle: 10*1000, // in milliseconds
    bufferSize: 1024*1024 // in byte
  };
  
  if(_.isUndefined(options)) {
    var options = {};
  }
  
  var bf = this;
  this.op = _.defaults(options, defaultOptions);
  
  bf.buf = new Buffers();
  // bf.writtenSize = 0;
  bf.fileSize = 0;
  bf.wholeSize = 0;
  bf.fd = null;

  async.auto({
    'open_file_for_read': function(callback){
      openFile(bf, callback);
    },
    'fetch_filesize': ['open_file_for_read', function(callback){
      fs.fstat(bf.fd, function(err, stats){
        if (err) {
          logger.error('Error while fetch stat in BufferedFile: ', err);
          callback(err);
        } else{
          bf.fileSize = stats.size;
          bf.wholeSize = bf.fileSize;
          callback();
        }
      });
    }],
    'start_timer': ['open_file_for_read', 'fetch_filesize', function(callback){
      if(bf.op.writeCycle == 0) {
        callback();
        return;
      }

      bf.timer = setInterval(cycledWrite, bf.op.writeCycle, bf);
      callback();
    }]
  }, function(err){
    if (err) {
      logger.error('Error while creating BufferedFile: ', err);
    }else{
      process.nextTick(function(){bf.emit('ready');});
    }
  });
}

util.inherits(BufferedFile, events.EventEmitter);

BufferedFile.prototype.writeToDisk = function (fn) {
  var bf = this;
  if(bf.buf.length < 1){
    return;
  }

  var data = bf.buf.toBuffer();
  fs.appendFile(bf.op.fileName, data, function(err) {
    if(err) {
      logger.log(err);
    }else{
      bf.fileSize += data.length;
      if( fn && _.isFunction(fn) ){
          fn();
      }
    }
  });
  bf.buf = new Buffers();
  bf.emit('written');
};

BufferedFile.prototype.append = function (data, fn) {
  var bf = this;
  bf.buf.push(data);
  bf.wholeSize += data.length;
  if(bf.buf.length >= bf.op.bufferSize){
    bf.writeToDisk();
  }
  if( fn && _.isFunction(fn) ){
    fn();
  }
    
};

BufferedFile.prototype.read = function (pos, length, fn) {
  var bf = this;

  if (pos >= bf.fileSize) {
    // all in buffers
    var start = pos - bf.fileSize;
    var bbb = bf.buf.slice(start, start+length);
    if (bbb.length != length) {
      logger.trace('pos, length, fileSize, wholeSize:', pos, length, bf.fileSize, bf.wholeSize);
      logger.trace('length in Buffers: ', bf.buf.length);
      logger.trace('wanted length: ', length, 'fetched:', bbb.length, 'all in buffer', bbb.toString('hex'));
    }
    fn(bbb);
  } else {
    if (pos+length > bf.fileSize) {
      // what if part of the block is in buffers 
      // and part of the block is in file?
      var file_part_length = bf.fileSize - pos;
      var buffer_part_length = pos + length - bf.fileSize;
      
      // read file part first
      fs.read(bf.fd, new Buffer(file_part_length), 0, file_part_length, pos, function(err, bytesRead, file_part){
        if (err) {
          logger.error('Error when read file', err);
        } else {
          if (fn && _.isFunction(fn) ) {
            var buffer_part = bf.buf.slice(0, buffer_part_length);
            var final_parts = Buffer.concat([file_part, buffer_part]);
            if (bytesRead != file_part_length) {
              logger.trace('pos, length, fileSize, wholeSize:', pos, length, bf.fileSize, bf.wholeSize);
              logger.trace('wanted length, pos: ', length, pos, 
                'buffer part: ', buffer_part_length, 
                'file part', file_part_length);
            }
            if (buffer_part.length != buffer_part_length) {
              logger.trace('pos, length, fileSize, wholeSize:', pos, length, bf.fileSize, bf.wholeSize);
              logger.trace('wanted length, pos: ', length, pos, 
                'buffer part: ', buffer_part_length, 
                'file part', file_part_length);
            }
            fn(final_parts);
          }
        }
      });
    }else{
      // all in file
      fs.read(bf.fd, new Buffer(length), 0, length, pos, function(err, bytesRead, buffer){
        if (err) {
          logger.error('Error when read file', err);
        } else {
          if (fn && _.isFunction(fn) ) {
            if (bytesRead != length) {
              logger.trace('pos, length, fileSize, wholeSize:', pos, length, bf.fileSize, bf.wholeSize);
              logger.trace('wanted length: ', length, 'all in file\n',
                'fetched:', bytesRead, buffer.toString('hex'));
            }
            fn(buffer);
          }
        }
      });
    }
  }
    
};

BufferedFile.prototype.readAll = function (fn) {
  var bf = this;

  function doRead(fun) {
    fs.readFile(bf.op.fileName, function (err, data) {
      if (err){
        logger.log(err);
        return;
      }
      if( fun && _.isFunction(fun) ){
        fun(data);
      }
    });
  }

  if(bf.buf.length > 0){
    bf.writeToDisk(function() {
      doRead(fn);
    });
  }else{
    doRead(fn);
  }
};

BufferedFile.prototype.clearAll = function (fn) {
  var bf = this;
  if(bf.buf.length > 0){
    bf.buf = new Buffers();
  }

  async.auto({
    'stop_timer': function(callback){
      clearInterval(bf.timer);
      callback();
    },
    'close_file': function(callback){
      fs.close(bf.fd, callback);
    },
    'truncate_file': ['stop_timer', 'close_file', function(callback){
      bf.fileSize = 0;
      bf.wholeSize = 0;
      fs.truncate(bf.op.fileName, 0, callback);
    }],
    'reopen_file': ['truncate_file', function(callback){
      openFile(bf, callback);
    }],
    'restart_timer': ['reopen_file', function(callback){
      bf.timer = setInterval(cycledWrite, bf.op.writeCycle, bf);
      callback();
    }],
    'signaling': ['restart_timer', function(callback){
      bf.emit('cleared');
      callback();
    }]
  }, function(err){
    if (err) {
      logger.error('Error when clearAll', err);
    }else{
      if (fn && _.isFunction(fn)) {
        fn();
      };
    }
  });
};

BufferedFile.prototype.cleanup = function (fn) {
  var bf = this;
  if ('op' in bf) {
    bf.op = null;
    delete bf['op'];
  }

  if ('buf' in bf) {
    bf.buf = null;
    delete bf['buf'];
  }

  if ('timer' in bf) {
    clearInterval(bf.timer);
    bf.timer = null;
    delete bf['timer'];
  }

  bf.emit('destroyed');

  bf.removeAllListeners();

  if (fn && _.isFunction(fn)) {
    fn();
  };
};

module.exports = BufferedFile;