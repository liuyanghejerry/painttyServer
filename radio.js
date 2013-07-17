var events = require('events');
var fs = require('fs');
var util = require("util");
var Writable = require('stream').Writable;
var Buffers = require('buffers');
var _ = require('underscore');
var async = require('async');
var common = require('./common.js');
var logger = common.logger;
var globalConf = common.globalConf;

var CHUNK_SIZE = 1024; // Bytes

function RadioReceiver(options) {
  events.EventEmitter.call(this, options);
  var self = this;

  var defaultOptions = new
  function() {
    this.filename = '';
    this.recovery = false;
  };

  if (_.isUndefined(options)) {
    var options = {};
  }
  var op = _.defaults(options, defaultOptions);
  self.options = op;
  self.clients = [];


  async.auto({
    'create_file': function(callback){
      if (self.options.recovery !== true) {
        fs.truncate(self.options.filename, 0, callback);
      }else{
        callback();
      }
    },
    'create_writeStream': ['create_file', function(callback){
      self.writeStream = fs.createWriteStream(self.options.filename, {flags: 'a'});
      self.writeStream.on('error', function(er){
        logger.error('Error while streaming', er);
      }).once('open', function() {
        callback();
      });
    }],
    'open_file_for_read': ['create_file', function(callback){
      fs.open(self.options.filename, 'a+', function(err, fd){
        if (err) {
          logger.error('Error while opening archive file', err);
          callback(err);
        }else{
          self.readStreamFd = fd;
          callback();
        }
      });
    }],
    'fecth_size': ['open_file_for_read', function(callback){
      if (self.options.recovery === true) {
        fs.fstat(self.readStreamFd, function(err, stats){
          if (err) {
            logger.error('Error while getting stats of archive file', err);
            callback(err);
          }else{
            self.lastPos = stats.size;
            callback();
          }
        });
      }else{
        self.lastPos = 0;
        callback();
      }
    }],
    'ready': ['create_file', 'open_file_for_read', 'fecth_size', function(callback) {
      self.emit('ready');
      callback();
    }]
  }, function(err) {
    if (err) {
      logger.error('Error while creating RadioReceiver: ', err);
    }    
  });
}

util.inherits(RadioReceiver, events.EventEmitter);

function split_chunk (start, length) {
  var result_queue = [];

  var chunks = Math.floor(length/CHUNK_SIZE);
  var c_pos = 0;
  for(var i = 0; i<chunks; ++i ){
    result_queue.push({'start': c_pos, 'length': CHUNK_SIZE});
    c_pos += CHUNK_SIZE;
  }

  if (length%CHUNK_SIZE > 0) {
    result_queue.push({'start': c_pos, 'length': length%CHUNK_SIZE});
  };

  return result_queue;
}

function push_large_chunk (start, length, queue) {
  var new_items = split_chunk(start, length);
  queue = queue.concat(new_items);
  return queue;
}

RadioReceiver.prototype.write = function(chunk, source) {
  if(this.writeStream) {
    var r = this;

    var lPos = r.lastPos;
    r.lastPos += chunk.length;
    var chunkLength = chunk.length;

    r.writeStream.write(chunk, function() {
      async.each(r.clients, function(ele, callback){
        if (ele == source) {
          callback();
          return;
        }else{
          if (ele.pendingList.length > 0) {
            var topItem = ele.pendingList.pop();
            // try to merge new chunk into old chunk
            var new_start = topItem['start'] + topItem['length'];
            var new_length = topItem['length'] + chunkLength;
            if (new_start == lPos) { // if two chunks are neighbor
              // concat two chunks and re-split them
              ele.pendingList = push_large_chunk(topItem['start'], new_length, ele.pendingList);
            }else{ // or just push those in
              ele.pendingList.push(topItem); // push the old chunk back
              ele.pendingList = push_large_chunk(lPos, chunkLength, ele.pendingList); // and new one
            }
          }else{
            ele.pendingList = push_large_chunk(lPos, chunkLength, ele.pendingList);
            // NOTE: we don't have to trigger queue process. It will handled in 'drain' event of Client.
          }
          callback();
        }
      }, function(err){
        if (err) {
          logger.error('Error while appending jobs to clients', err);
        } 
      });
    }); 
    
  }else{
    logger.error('RadioReceiver commanded to write without stream attached');
  }
};

RadioReceiver.prototype.addClient = function(cli) {
  this.clients.push(cli);
  var receiver = this;
  cli.pendingList = [];
  cli.processPending = function(done) {
    var c = cli;
    if (c && c.pendingList) {
      // send chunks one by one in pendingList
      _.each(c.pendingList, function(item, index, list){
        // process data
        // read one chunk from file
        // logger.trace('process chunk:', item['start'], item['length']);
        fs.read(receiver.readStreamFd, new Buffer(item['length']), 0, 
          item['length'], item['start'], function(err, bytes, buf) {
          if (err) {
            logger.error('Error while process reading', err);
            // callback(err);
            return;
          }

          // send only if we get it
          if (bytes > 0) {
            c.write(buf, function() {
              c.pendingList.shift();
            });
          }else{
            logger.warn('Warning, read 0 bytes when fetch file!', 
              'length: ', item['length'], ', start:', item['start']);
            // FIXME: what if we have no data?!
          }
        });
        // r_buffer = null;
      });
      if (_.isFunction(done)) {
        done();
      }
    };
  };

  // send record when join
  async.waterfall([
    // fetch file size
    function(callback){
      fs.fstat(receiver.readStreamFd, function(err, stat) {
        if (err) {
          logger.error('Error while getting stat of file', err);
          callback(err);
        };
        callback(null, stat.size);
      });
    },
    // slice whole file into pieces
    function(fileSize, callback){
      cli.pendingList = cli.pendingList.concat(split_chunk(0, fileSize));
      // logger.trace('pendingList after slice file: ', cli.pendingList);
      callback();
    },
    // send them
    function(callback) {
      cli.processPending(callback);
    }
  ], function(err, result){
    if (err) {
      logger.error('Error while sending record', err);
    }
  });

  function ondatapack(source, data) {
    receiver.write(data, source);
  }

  function ondrain() {
    if(cli.processPending) {
      cli.processPending();
    }
  }

  function onclose() {
    cli.pendingList = null;
    if (receiver.clients) {
      var index = receiver.clients.indexOf(cli);
      receiver.clients.splice(index, 1);
    }
  }

  function cleanup() {
    cli.removeListener('datapack', ondatapack);
    cli.removeListener('drain', ondrain);
  }

  cli.on('datapack', ondatapack)
  .on('drain', ondrain)
  .once('close', onclose)
  .once('close', cleanup);

  return this;
};

RadioReceiver.prototype.prune = function() {
  var self = this;
  async.series([
      // delete old pending chunks
      function(callback){
        async.each(self.clients, function(item){
          item.pendingList = [];
        }, callback);
      },
      // close old write stream
      function(callback){
        if (self.writeStream) {
          self.writeStream.end(function(){
            self.writeStream = null; 
            callback();
          }); 
        }else{
          callback();
        }
      },
      // close old read stream
      function(callback){
        if (self.readStreamFd) {
          fs.close(self.readStreamFd, function(err){
            if (err) {
              logger.error('Error when close archive file', err);
              callback(err);
            }else{
              self.readStreamFd = null;
              callback();
            }            
          });
        }
      },
      // truncate file
      function(callback){
        fs.truncate(self.options.filename, 0, function(err){
          if (err) {
            logger.error('truncate error: ', err);
            callback(err);
          } else{
            callback();
          }
        });
      },
      // re-create write stream
      function(callback){
        self.writeStream = fs.createWriteStream(self.options.filename, {flags: 'a'});
        self.lastPos = 0;
        self.writeStream.on('error', function(er){
          logger.error('Error while streaming', er);
        }).once('open', function() {
          callback();
        });
      },
      // re-create read stream
      function(callback){
        fs.open(self.options.filename, 'a+', function(err, fd){
          if (err) {
            logger.error('Error while opening archive file', err);
            callback(err);
          }else{
            self.readStreamFd = fd;
            callback();
          }
        });
      }
    ],
    function(err, results){
      if (err) {
        logger.error('Error when prune:', err);
      } else{
        // logger.trace('prune done.');
      }
    });
  return this;
};

RadioReceiver.prototype.removeFile = function() {
  fs.unlink(this.options.filename);
};

RadioReceiver.prototype.cleanup = function() {
  this.options = null;
  this.clients = null;
  var self = this;
  if (this.writeStream) {
    this.writeStream.end();
    this.writeStream = null;
  }

  if (this.readStreamFd) {
    fs.close(this.readStreamFd, function(err){
      if (err) {
        logger.error('Error when close archive file', err);
      }else{
        self.readStreamFd = null;
      }            
    });
  }
};

function Radio(options) {
  events.EventEmitter.call(this);
  var radio = this;

  var defaultOptions = new
  function() {
    this.dataFile = '';
    this.msgFile = '';
    this.recovery = false;
  };

  if (_.isUndefined(options)) {
    var options = {};
  }
  var op = _.defaults(options, defaultOptions);
  radio.options = op;

  async.auto({
    'create_dataRadio': function(callback){
      radio.dataRadio = new RadioReceiver({
        'filename': radio.options.dataFile, 
        'recovery': radio.options.recovery
      });

      radio.dataRadio.on('error', function(er){
        logger.error('Error while running radio', er);
      }).once('ready', callback);
    },
    'create_msgRadio': function(callback){
      radio.msgRadio = new RadioReceiver({
        'filename': radio.options.msgFile, 
        'recovery': radio.options.recovery
      });

      radio.msgRadio.on('error', function(er){
        logger.error('Error while running radio', er);
      }).once('ready', callback);
    },
    'ready': ['create_dataRadio', 'create_msgRadio', function(callback) {
      radio.emit('ready');
      callback();
    }]
  }, function(err) {
    if (err) {
      logger.error('Error while creating Radio: ', err);
      if (radio.msgRadio) {
        radio.msgRadio.cleanup();
      };
      if (radio.dataRadio) {
        radio.dataRadio.cleanup();
      };
    }
  });

}

util.inherits(Radio, events.EventEmitter);

Radio.prototype.writeData = function(chunk, client) {
  if (this.dataRadio) {
    this.dataRadio.write(chunk, client);
  }
};

Radio.prototype.dataLength = function() {
  if (this.dataRadio) {
    return this.dataRadio.lastPos;
  }else{
    return 0;
  }
};

Radio.prototype.writeMsg = function(chunk) {
  if (this.msgRadio) {
    this.msgRadio.write(chunk, client);
  }
};

Radio.prototype.msgLength = function() {
  if (this.msgRadio) {
    return this.msgRadio.lastPos;
  }else{
    return 0;
  }
};

Radio.prototype.joinMsgGroup = function(client) {
  if (this.msgRadio) {
    this.msgRadio.addClient(client);
  }
};

Radio.prototype.joinDataGroup = function(client) {
  if (this.dataRadio) {
    this.dataRadio.addClient(client);
  }
};

Radio.prototype.removeFile = function() {
  if (this.dataRadio) {
    this.dataRadio.removeFile();
  }
  if (this.msgRadio) {
    this.msgRadio.removeFile();
  }
};

Radio.prototype.cleanup = function() {
  this.options = null;
  if (this.dataRadio) {
    this.dataRadio.cleanup();
  }
  if (this.msgRadio) {
    this.msgRadio.cleanup();
  }
};

module.exports = Radio;