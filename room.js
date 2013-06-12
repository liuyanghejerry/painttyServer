var events = require('events');
var fs = require('fs');
var cluster = require('cluster');
var domain = require('domain');
var util = require("util");
var crypto = require('crypto');
var Buffers = require('buffers');
var _ = require('underscore');
var async = require('async');
var logger = require('tracer').dailyfile({root:'./logs'});
var bw = require("buffered-writer");
var common = require('./common.js');
var socket = require('./socket.js');
var BufferedFile = require("./bufferedfile.js");
var Router = require("./router.js");

function Room(options) {
  events.EventEmitter.call(this);

  var defaultOptions = new
  function() {
    var self = this;
    self.name = '';
    self.canvasSize = {
      width: 720,
      height: 480
    };
    self.password = ''; // for private room
    self.maxLoad = 5;
    self.welcomemsg = '';
    self.emptyclose = false;
    self.permanent = false;
    self.expiration = 0; // 0 for limitless
    self.salt = '';
    self.log = false;
  };

  if (_.isUndefined(options)) {
    var options = {};
  }
  var op = _.defaults(options, defaultOptions);
  if (!_.isString(op.name) || op.name.length < 1) {
    common.log('valid name');
    // TODO: throw exception
    return;
  }
  op.logLocation = function() {
    var hash = crypto.createHash('sha1');
    hash.update(op.name, 'utf8');
    hash = hash.digest('hex');
    return './logs/rooms/' + hash + '.log';
  } ();

  var room = this;
  room.workingSockets = 0;
  room.options = op;
  room.router = new Router();

  // NOTE: here we use sync read function 
  // to ensure we have that key when running.
  if (room.options.salt.length < 1) {
    room.options.salt = fs.readFileSync('./config/salt.key');
  }

  var hash_source = room.options.name + room.options.salt;
  var hashed = crypto.createHash('sha1');
  hashed.update(hash_source, 'utf8');
  room.signed_key = hashed.digest('hex');

  function prepareCheckoutTimer(r_room) {
    if (r_room.options.expiration) {
      r_room.checkoutTimer = setTimeout(function onTimeout() {
        if (r_room.currentLoad() > 0) {
          r_room.options.emptyclose = true;
        }else{
          r_room.close();
        }       
      },
      r_room.options.expiration * 3600 * 1000);
    }
  };
  prepareCheckoutTimer(room);

  room.dataFile = function() {
    fs.exists('./data/room/',
    function(exists) {
      if (!exists) {
        fs.mkdirSync('./data/room/');
      }
    });

    var hash = crypto.createHash('sha1');
    hash.update(room.options.name, 'utf8');
    hash = hash.digest('hex');
    return './data/room/' + hash + '.data';
  } ();
  

  room.msgFile = function() {
    fs.exists('./data/room/',
    function(exists) {
      if (!exists) {
        fs.mkdirSync('./data/room/');
      }
    });

    var hash = crypto.createHash('sha1');
    hash.update(op.name, 'utf8');
    hash = hash.digest('hex');
    return './data/room/' + hash + '.msg';
  } ();
  room.dataFileSize = 0;
  room.msgFileSize = 0; // not really used, currently

  async.auto({
    'create_dataFile': function(callback){
      logger.debug('create_dataFile');
      fs.truncate(room.dataFile, 0, callback);
    },
    'create_msgFile': function(callback){
      logger.debug('create_msgFile');
      fs.open(room.msgFile, 'w', callback);
    },
    'make_dataStream': ['create_dataFile', function(callback){
      logger.debug('make_dataStream');
      room.dataFile_writeStream = fs.createWriteStream(room.dataFile);
      room.dataFile_writeStream.on('error', function(er){
        logger.error('Error while streaming', er);
      });
      callback();
    }],
    'make_msgStream': ['create_msgFile', function(callback){
      logger.debug('make_msgStream');
      room.msgFile_writeStream = fs.createWriteStream(room.msgFile);
      room.msgFile_writeStream.on('error', function(er){
        logger.error('Error while streaming', er);
      });
      callback();
    }],
    'init_dataSocket': ['make_dataStream', function(callback){
      logger.debug('init_dataSocket');
      room.dataSocket = new socket.SocketServer();
      room.dataSocket.maxConnections = room.options.maxLoad;
      room.dataSocket.on('datapack',
      function(cli, dbuf) {
        room.dataFile_writeStream.write(dbuf);
        room.dataFileSize += dbuf.length;
      }).on('connection',
      function(con) {
        var r_stream = fs.createReadStream(room.dataFile);
        r_stream.on('error', function(er){
          logger.error('Error while streaming', er);
        });
        r_stream.on('readable', function(){
          var buf;
          while (buf = r_stream.read()) {
            con.write(buf);
          }
        });
        if (cluster.isWorker) {
          cluster.worker.send({
            'message': 'loadchange',
            'info': {
              'name': room.options.name,
              'currentLoad': room.currentLoad()
            }
          });
        };
      });
      callback();
    }],
    'init_msgSocket': ['make_msgStream', function(callback){
      logger.debug('init_msgSocket');
      room.msgSocket = new socket.SocketServer();
      room.msgSocket.maxConnections = room.options.maxLoad;
      room.msgSocket.on('connection', function(con) {
        con.on('end', function() {
          if (cluster.isWorker) {
            cluster.worker.send({
              'message': 'loadchange',
              'info': {
                'name': room.options.name,
                'currentLoad': room.currentLoad()
              }
            });
          };
          if (room.options.emptyclose) {
            logger.debug('On socket exits, currentLoad:', room.currentLoad());
            if (room.currentLoad() <= 1) { // when exit, still connected on.
              room.close();
            }
          }
        });

        room.msgSocket.sendData(con, common.jsonToString({
          content: '欢迎使用茶绘君，我们的主页：http://mrspaint.com。\n' 
          + '如果您在使用中有任何疑问，' 
          + '请在茶绘君贴吧留言：'
           + 'http://tieba.baidu.com/f?kw=%B2%E8%BB%E6%BE%FD \n'
        }));
        // TODO: use cmd channal
        // var send_msg = '<p style="font-weight:bold;">欢迎使用'+
        //             '<a href="http://mrspaint.com">茶绘君</a>。<br/>'+
        //             '如果您在使用中有任何疑问，'+
        //             '请在<a href="http://tieba.baidu.com/f?kw=%B2%E8%BB%E6%BE%FD">茶绘君贴吧</a>留言。</p>\n';
        // BUG: use con will send msg into msgSocket, not cmdSocket
        // room.notify(con, send_msg);
        if (room.options.welcomemsg.length) {
          room.msgSocket.sendData(con, common.jsonToString({
            content: room.options.welcomemsg + '\n'
          }));
        }
        // room.msgFile_readStream.pipe(con);
        var r_stream = fs.createReadStream(room.msgFile);
        r_stream.on('error', function(er){
          logger.error('Error while streaming', er);
        });
        r_stream.on('readable', function(){
          var buf;
          while (buf = r_stream.read()) {
            con.write(buf);
          }
        });
      }).on('datapack',
      function(cli, dbuf) {
        room.msgFile_writeStream.write(dbuf);
      });
      callback();
    }],
    'install_router': ['init_msgSocket', 'init_dataSocket', function(callback){
      logger.debug('install_router');
      room.router.reg('request', 'login',
      function(cli, obj) {
        var r_room = room;
        // name check
        if (!obj['name'] || !_.isString(obj['name'])) {
          var ret = {
            response: 'login',
            result: false,
            errcode: 301
          };
          logger.log(ret);
          var jsString = common.jsonToString(ret);
          r_room.cmdSocket.sendData(cli, new Buffer(jsString));
          return;
        }
        // password check
        if (r_room.options.password.length > 0) {
          if (!obj['password'] || !_.isString(obj['password']) || obj['password'] != r_room.options.password) {
            var ret = {
              response: 'login',
              result: false,
              errcode: 302
            };
            logger.log(ret);
            var jsString = common.jsonToString(ret);
            r_room.cmdSocket.sendData(cli, new Buffer(jsString));
            return;
          }
        }
        // send info
        var ret = {
          response: 'login',
          result: true,
          info: {
            historysize: r_room.dataFileSize,
            dataport: r_room.ports().dataPort,
            msgport: r_room.ports().msgPort,
            size: r_room.options.canvasSize,
            clientid: function() {
              var hash = crypto.createHash('sha1');
              hash.update(r_room.options.name + obj['name'] + r_room.options.salt + (new Date()).getTime(), 'utf8');
              hash = hash.digest('hex');
              cli['clientid'] = hash;
              return hash;
            } ()
          }
        };
        logger.log(ret);
        var jsString = common.jsonToString(ret);
        r_room.cmdSocket.sendData(cli, new Buffer(jsString));
        cli['username'] = obj['name'];
        return;
      },
      room).reg('request', 'close',
      function(cli, obj) {
        var r_room = room;
        // check signed key
        if (!obj['key'] || !_.isString(obj['key'])) {
          var ret = {
            response: 'close',
            result: false
          };
          logger.log(ret);
          var jsString = common.jsonToString(ret);
          r_room.cmdSocket.sendData(cli, new Buffer(jsString));
        } else {
          if (obj['key'].toLowerCase() == r_room.signed_key.toLowerCase()) {
            var ret = {
              response: 'close',
              result: true
            };
            logger.log(ret);
            var jsString = common.jsonToString(ret);
            r_room.cmdSocket.sendData(cli, new Buffer(jsString));
            var ret_all = {
              action: 'close',
              'info': {
                reason: 501
              }
            };
            jsString = common.jsonToString(ret_all);
            logger.log(jsString);
            r_room.cmdSocket.broadcastData(new Buffer(jsString));
            r_room.options.emptyclose = true;
          }
        }
      },
      room).reg('request', 'clearall',
      function(cli, obj) {
        var r_room = room;
        if (!obj['key'] || !_.isString(obj['key'])) {
          var ret = {
            response: 'clearall',
            result: false
          };
          var jsString = common.jsonToString(ret);
          r_room.cmdSocket.sendData(cli, new Buffer(jsString));
        } else {
          if (obj['key'].toLowerCase() == r_room.signed_key.toLowerCase()) {      
            fs.truncate(r_room.dataFile, 0, function(err){
              if(err) {
                  logger.error(err);
                  return;
              }
              r_room.dataFileSize = 0;
              room.dataFile_writeStream = fs.createWriteStream(room.dataFile);
              room.dataFile_writeStream.on('error', function(er){
                logger.error('Error while streaming', er);
              });

              var ret = {
                response: 'clearall',
                result: true
              };
              var jsString = common.jsonToString(ret);
              r_room.cmdSocket.sendData(cli, new Buffer(jsString));
              var ret_all = {
                action: 'clearall',
              };
              jsString = common.jsonToString(ret_all);
              r_room.cmdSocket.broadcastData(new Buffer(jsString));
            });
          } else {
            var ret = {
              response: 'clearall',
              result: false
            };
            var jsString = common.jsonToString(ret);
            r_room.cmdSocket.sendData(cli, new Buffer(jsString));
          }
        }
      },
      room).reg('request', 'onlinelist',
      function(cli, obj) {
        var r_room = room;
        if (!obj['clientid']) {
          return;
        }
        logger.log('onlinelist request by', obj['clientid']);
        if (!_.findWhere(r_room.cmdSocket.clients, {
          'clientid': obj['clientid']
        })) {
          return;
        }

        var people = [];
        _.each(r_room.cmdSocket.clients,
        function(va) {
          if (va['username'] && va['clientid']) {
            people.push({
              'name': va['username'],
              'clientid': va['clientid']
            });
          }
        });
        if (!people.length) {
          return;
        }

        var ret = {
          response: 'onlinelist',
          result: true,
          onlinelist: people
        };
        logger.log(ret);
        var jsString = common.jsonToString(ret);
        r_room.cmdSocket.sendData(cli, new Buffer(jsString));
      },
      room).reg('request', 'checkout',
      function(cli, obj) {
        var r_room = room;
        if (!obj['key'] || !_.isString(obj['key'])) {
          var ret = {
            response: 'checkout',
            result: false,
            errcode: 701
          };
          logger.log(ret);
          var jsString = common.jsonToString(ret);
          r_room.cmdSocket.sendData(cli, new Buffer(jsString));
        }
        if (obj['key'].toLowerCase() == r_room.signed_key.toLowerCase()) {
          if (r_room.checkoutTimer) {
            clearTimeout(r_room.checkoutTimer);
            prepareCheckoutTimer(r_room);
          }
          var ret = {
            response: 'checkout',
            result: true,
            cycle: r_room.options.expiration ? r_room.options.expiration: 0
          };
          logger.log(ret);
          var jsString = common.jsonToString(ret);
          r_room.cmdSocket.sendData(cli, new Buffer(jsString));
        }
      },
      room);
      callback();
    }],
    'init_cmdSocket': ['install_router', function(callback){
          logger.debug('init_cmdSocket');
          room.cmdSocket = new socket.SocketServer({
            autoBroadcast: false,
            useAlternativeParser: function(cli, buf) {
              var obj = common.stringToJson(buf);
              room.router.message(cli, obj);
            }
          });
          room.cmdSocket.maxConnections = room.options.maxLoad;
          callback();
    }],
    'start_socketListener': ['init_cmdSocket', function(callback){
      logger.debug('start_socketListener');
      logger.debug(room.cmdSocket);

      var tmpF = function() {
        room.workingSockets += 1;
        if (room.workingSockets >= 3) {
          room.emit('create', {
            cmdPort: room.cmdSocket.address().port,
            maxLoad: room.options.maxLoad,
            currentLoad: room.currentLoad(),
            name: room.options.name,
            key: room.signed_key,
            'private': room.options.password.length > 0
          });

          function uploadCurrentInfo() {
            if (cluster.isWorker) {
              cluster.worker.send({
                'message': 'roominfo',
                'info':{
                  'name': room.options.name,
                  'cmdPort': room.cmdSocket.address().port,
                  'maxLoad': room.options.maxLoad,
                  'currentLoad': room.currentLoad(),
                  'private': room.options.password.length > 0,
                  'timestamp': (new Date()).getTime()
                }
              });
            };
          }
          room.uploadCurrentInfoTimer = setInterval(uploadCurrentInfo, 1000*10);
        }
      };

      room.dataSocket.on('listening', tmpF);
      room.cmdSocket.on('listening', tmpF);
      room.msgSocket.on('listening', tmpF);

      room.cmdSocket.listen(0, '::'); // this will support both ipv6 and ipv4 address
      room.dataSocket.listen(0, '::');
      room.msgSocket.listen(0, '::');

      callback();
    }]
  }, function(er, re){
    if (er) {
      logger.error('Error while creating Room: ', er);
    };
  });  
}

util.inherits(Room, events.EventEmitter);

Room.prototype.start = function() {
  return this;
};

Room.prototype.ports = function() {
  return {
    cmdPort: this.cmdSocket.address().port,
    dataPort: this.dataSocket.address().port,
    msgPort: this.msgSocket.address().port
  };
};

Room.prototype.close = function() {
  var self = this;
  
  logger.log('Room', self.options.name, 'is closed.');
  clearInterval(self.uploadCurrentInfoTimer);
  clearTimeout(self.checkoutTimer);
  self.emit('close');
  if (cluster.isWorker) {
    cluster.worker.send({
      'message': 'roomclose',
      'info':{
        'name': self.options.name
      }
    })
  };
  self.cmdSocket.close();
  self.dataSocket.close();
  self.msgSocket.close();
  if (!self.options.permanent) {
    fs.unlink(self.dataFile,
    function() {});
    fs.unlink(self.msgFile,
    function() {});
  }
  
  return this;
};

Room.prototype.currentLoad = function() {
  // do not count cmdSocket because it's a public socket
  return Math.max(this.dataSocket.clients.length, 
    this.msgSocket.clients.length);
};

Room.prototype.notify = function(con, content) {
  var self = this;
  var sendContent = {
    action: 'notify',
    'content': content
  };
  self.cmdSocket.sendData(con, common.jsonToString(sendContent));
  logger.debug('cmdSocket: ', self.cmdSocket, sendContent);
};

Room.prototype.bradcastMessage = function(content) {
  var self = this;
  var sendContent = {
    action: 'notify',
    'content': content
  };
  self.cmdSocket.broadcastData(common.jsonToString(sendContent));
};

module.exports = Room;