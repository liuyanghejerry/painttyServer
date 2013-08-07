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

function Radio(options) {
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
      logger.error('Error while creating Radio: ', err);
    }else{
      process.nextTick(function(){self.emit('ready');});
    }
  });
}

util.inherits(Radio, events.EventEmitter);

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

  if (list.length >= MAX_CHUNKS_IN_QUEUE*2) {
    // TODO: add another function to re-split chunks in queue
    logger.warn('There\'re ', list.length, 'chunks in a single queue!');
  }
  return list;
}

Radio.prototype.write = function(datachunk, source) {
  if(this.writeBufferedFile) {
    var r = this;

    r.writeBufferedFile.append(datachunk, function() {
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
    logger.error('Radio commanded to write without stream attached');
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

Radio.prototype.addClient = function(cli) {
  this.clients.push(cli);
  var radio = this;
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
          fetch_and_send(c.pendingList, radio.writeBufferedFile, c, function(go_on){
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
      callback(null, radio.writeBufferedFile.wholeSize);
    },
    // slice whole file into pieces
    function(fileSize, callback){
      if (cli.pendingList) {
        cli.pendingList = cli.pendingList.concat(split_chunk(new RadioChunk(0, fileSize)));
        callback();
      }else{
        callback(new Error("Client has been closed"));
      }
      
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
    if (radio.clients) {
      var index = radio.clients.indexOf(cli);
      radio.clients.splice(index, 1);
    }
  }

  var cleanup = function () {
    cli.removeListener('drain', ondrain);
  }

  cli.on('drain', ondrain)
  .once('close', onclose)
  .once('close', cleanup);

  return this;
};

Radio.prototype.prune = function() {
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

Radio.prototype.removeFile = function() {
  fs.unlink(this.options.filename);
};

Radio.prototype.cleanup = function() {
  this.options = null;
  this.clients = null;
  var self = this;
  if (this.writeBufferedFile) {
    this.writeBufferedFile.cleanup();
    this.writeBufferedFile = null;
  }
  this.removeAllListeners();
};

module.exports = Radio;