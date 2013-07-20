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
    'open_buffered_file': ['create_file', function(callback){
      self.writeBufferedFile = new BufferedFile({
        'fileName': self.options.filename
      });
      callback();
    }],
    'fecth_size': ['open_buffered_file', function(callback){
      if (self.options.recovery === true) {
        self.lastPos = self.writeBufferedFile.wholeSize;
      }else{
        self.lastPos = 0;
        callback();
      }
    }],
    'ready': ['create_file', 'fecth_size', function(callback) {
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
  var c_pos = start;
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
  var new_queue = queue.concat(new_items);
  // logger.trace('queue: ', queue, 'new_queue: ', new_queue);
  return new_queue;
}

function appendToPendings(pos, chunkLength, list) {
  // logger.trace('pos', pos, 'chunkLength', chunkLength, 'list', list);
  
  if (list.length > 0) {
    var bottomItem = list.pop();
    // try to merge new chunk into old chunk
    var new_length = bottomItem['length'] + chunkLength;
    if (bottomItem['start'] + bottomItem['length'] == pos) { // if two chunks are neighbor
      // concat two chunks and re-split them
      list = push_large_chunk(bottomItem['start'], new_length, list);
    }else{ // or just push those in
      list.push(bottomItem); // push the old chunk back
      list = push_large_chunk(pos, chunkLength, list); // and new one
    }
  }else{
    list = push_large_chunk(pos, chunkLength, list);
    // NOTE: we don't have to trigger queue process. It will handled in 'drain' event of Client.
  }
  return list;
}

RadioReceiver.prototype.write = function(chunk, source) {
  if(this.writeBufferedFile) {
    var r = this;

    r.writeBufferedFile.append(chunk, function() {
      async.each(r.clients, function(ele, callback){
        if (ele == source) {
          callback();
          return;
        }else{
          ele.pendingList = appendToPendings(r.lastPos, chunk.length, ele.pendingList);
          // logger.trace('after merge', ele.pendingList);
          callback();
        }
      }, function(err){
        if (err) {
          logger.error('Error while appending jobs to clients', err);
        } 
      });
    });
    r.lastPos += chunk.length;
    
  }else{
    logger.error('RadioReceiver commanded to write without stream attached');
  }
};

function fetch_and_send(list, bufferedfile, client, ok) {
  if (list && list.length > 0) {
    var item = _.first(list);
    list.shift();
    bufferedfile.read(item['start'], item['length'], function(datachunk){
      if (datachunk.length > 0) {
        var isIdel = client.write(datachunk);
        if (ok && _.isFunction(ok)) {
          ok(isIdel);
        }
      }else{
        logger.warn('Warning, read 0 bytes when fetch file!', 
          'length: ', item['length'], ', start:', item['start']);
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
    if (c && c.pendingList) {
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
    };
  };

  // send record when join
  async.waterfall([
    // fetch file size
    function(callback){
      callback(null, receiver.writeBufferedFile.wholeSize);
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
    cli.sendTimer = setInterval(function(){
      if(cli && cli.processPending) cli.processPending();
    }, 5000);
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
    clearInterval(cli.sendTimer);
    cli.sendTimer = null;
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