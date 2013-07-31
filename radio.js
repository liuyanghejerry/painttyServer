var events = require('events');
var fs = require('fs');
var util = require("util");
var Writable = require('stream').Writable;
var Buffers = require('buffers');
var _ = require('underscore');
var async = require('async');
var common = require('./common.js');
var BufferedFile = require('./bufferedfile.js');
var logger = common.logger;
var globalConf = common.globalConf;

var CHUNK_SIZE = 1024*400; // Bytes
var MAX_CHUNKS_IN_QUEUE = 2048; // which means there shuold be 2048 RadioChunk instances in pending queue at most
var SEND_INTERVAL = 800; // check pending list every 800ms to send new items

function RadioChunk(start, length) {
  this.start = start;
  this.chunkSize = length;
}

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
    'open_buffered_file': ['create_file', function(callback){
      self.writeBufferedFile = new BufferedFile({
        'fileName': self.options.filename
      });
      self.writeBufferedFile.once('ready', callback);
    }],
    'fecth_size': ['open_buffered_file', function(callback){
      if (self.options.recovery === true) {
        self.lastPos = self.writeBufferedFile.wholeSize;
      }else{
        self.lastPos = 0;
      }
      callback();
    }]
  }, function(err) {
    if (err) {
      logger.error('Error while creating RadioReceiver: ', err);
    }else{
      process.nextTick(function(){self.emit('ready');});
    }
  });
}

util.inherits(RadioReceiver, events.EventEmitter);

function split_chunk (chunk) {
  var result_queue = [];

  var real_chunk_size = CHUNK_SIZE;
  var chunks = Math.floor(chunk.chunkSize/real_chunk_size);
  
  // keep chunks in a reasonable amount
  while (chunks > MAX_CHUNKS_IN_QUEUE) {
    real_chunk_size *= 2;
    chunks = Math.floor(chunk.chunkSize/real_chunk_size);
  }
  var c_pos = chunk.start;
  for(var i = 0; i<chunks; ++i ){
    result_queue.push(new RadioChunk(c_pos, real_chunk_size));
    c_pos += real_chunk_size;
  }

  if (chunk.chunkSize%real_chunk_size > 0) {
    result_queue.push(new RadioChunk(c_pos, chunk.chunkSize%real_chunk_size));
  };

  return result_queue;
}

function push_large_chunk (chunk, queue) {
  var new_items = split_chunk(chunk);
  var new_queue = queue.concat(new_items);
  // logger.trace('queue: ', queue, 'new_queue: ', new_queue);
  return new_queue;
}

function appendToPendings(chunk, list) {
  
  if (list.length > 0) {
    var bottomItem = list.pop();
    // try to merge new chunk into old chunk
    var new_length = bottomItem['chunkSize'] + chunk.chunkSize;
    if (bottomItem['start'] + bottomItem['chunkSize'] == chunk.start) { // if two chunks are neighbor
      // concat two chunks and re-split them
      list = push_large_chunk(new RadioChunk(bottomItem['start'], new_length), list);
    }else{ // or just push those in
      list.push(bottomItem); // push the old chunk back
      list = push_large_chunk(new RadioChunk(chunk.start, chunk.chunkSize), list); // and new one
    }
  }else{
    list = push_large_chunk(new RadioChunk(chunk.start, chunk.chunkSize), list);
    // NOTE: we don't have to trigger queue process. It will handled in 'drain' event of Client.
  }

  if (list.length >= MAX_CHUNKS_IN_QUEUE) {
    // TODO: add another function to re-split chunks in queue
    logger.warn('There\'re ', list.length, 'chunks in a single queue!');
  }
  return list;
}

RadioReceiver.prototype.write = function(datachunk, source) {
  if(this.writeBufferedFile) {
    var r = this;

    r.writeBufferedFile.append(datachunk, function() {
      logger.trace('data appended');
      async.each(r.clients, function(ele, callback){
        if (ele == source) {
          callback();
        }else{
          ele.pendingList = appendToPendings(new RadioChunk(r.lastPos, datachunk.length), ele.pendingList);
          callback();
        }
      }, function(err){
        if (err) {
          logger.error('Error while appending jobs to clients', err);
        } 
      });
    });
    r.lastPos += datachunk.length;
    
  }else{
    logger.error('RadioReceiver commanded to write without stream attached');
  }
};

function fetch_and_send(list, bufferedfile, client, ok) {
  if (list && list.length > 0 && ok && _.isFunction(ok)) {
    var item = _.first(list);
    list.shift();

    bufferedfile.read(item['start'], item['chunkSize'], function(datachunk){
      if (datachunk.length == item['chunkSize']) {
        var isIdel = client.write(datachunk, function(){
          // logger.debug(datachunk);
          ok(isIdel);
        });
      }else{
        // fetch failed, should schedual another try
        list.unshift(item);
        ok(false);
      }
    });
  }
  ok(false);
}

RadioReceiver.prototype.addClient = function(cli) {
  this.clients.push(cli);
  var receiver = this;
  cli.pendingList = [];
  cli.processPending = function(done) {
    var c = cli;
    if (c && c.pendingList && c.pendingList.length > 0) {
      // send chunks one by one in pendingList
      
      var should_next = true;
      async.whilst(
        function() {
          return should_next;
        }, function(callback){
          fetch_and_send(c.pendingList, receiver.writeBufferedFile, c, function(go_on){
          should_next = go_on;
          callback();
        });
      }, function(err){
        if (err) {
          logger.error('Error when processPending', err);
        }
      });
      
      if (_.isFunction(done)) {
        done();
      }
    }else{
      if (done && _.isFunction(done)) {
        done();
      }
    }
  };

  // send record when join
  async.waterfall([
    // fetch file size
    function(callback){
      callback(null, receiver.writeBufferedFile.wholeSize);
    },
    // slice whole file into pieces
    function(fileSize, callback){
      cli.pendingList = cli.pendingList.concat(split_chunk(new RadioChunk(0, fileSize)));
      callback();
    },
    // send them
    function(callback) {
      cli.processPending(callback);
    },
    // set timer
    function(callback) {
      cli.sendTimer = setInterval(function(){
        if(cli) {
          cli.processPending();
        }else{
          logger.warn('timer still running after client destroyed!');
        }
      }, SEND_INTERVAL);
      callback();
    }
  ], function(err, result){
    if (err) {
      logger.error('Error while sending record', err);
    }
  });

  var ondatapack = function (source, data) {
    receiver.write(data, source);
  }

  var ondrain = function () {
    if(cli.processPending) {
      cli.processPending();
    }
  }

  var onclose = function () {
    if (cli.sendTimer) {
      clearInterval(cli.sendTimer);
      cli.sendTimer = null;
    }
    cli.pendingList = null;
    if (receiver.clients) {
      var index = receiver.clients.indexOf(cli);
      receiver.clients.splice(index, 1);
    }
  }

  var cleanup = function () {
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
      // FIXME: delete old chunks may result in a imcomplete data pack.
      function(callback){
        async.each(self.clients, function(item, done){
          item.pendingList = [];
          done();
        }, callback);
      },
      // clear file
      function(callback){
        self.writeBufferedFile.clearAll(callback);
      },
      // reset pos
      function(callback){
        self.lastPos = 0;
        callback();
      }
    ],
    function(err, results){
      if (err) {
        logger.error('Error when prune:', err);
      } else{
        self.emit('pruned');
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
  if (this.writeBufferedFile) {
    this.writeBufferedFile.cleanup();
    this.writeBufferedFile = null;
  }
  this.removeAllListeners();
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
    }
  }, function(err) {
    if (err) {
      logger.error('Error while creating Radio: ', err);
      if (radio.msgRadio) {
        radio.msgRadio.cleanup();
      };
      if (radio.dataRadio) {
        radio.dataRadio.cleanup();
      };
    }else{
      process.nextTick(function(){radio.emit('ready');});
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
  this.removeAllListeners();
};

module.exports = Radio;