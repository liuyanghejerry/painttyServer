var events = require('events');
var fs = require('fs');
var cluster = require('cluster');
var util = require("util");
var crypto = require('crypto');
var Buffers = require('buffers');
var _ = require('underscore');
var async = require('async');
var toobusy = require('toobusy');
var common = require('./common.js');
var socket = require('./streamedsocket.js');
var Radio = require('./radio.js');
var Router = require("./router.js");
var logger = common.logger;
var globalConf = common.globalConf;
var globalSalt = common.globalSalt;

function Room(options) {
  events.EventEmitter.call(this);
  var room = this;

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
    self.permanent = true;
    self.expiration = 48; // in hours; 0 for limitless
    self.log = false; // not really used
    self.recovery = false;
    self.lastCheckoutTimestamp = Date.now();
    // NOTICE: below options are generated in runtime or passed only when recovery
    self.salt = '';
    self.key = '';
    self.archive = '';
    self.port = 0;
  };

  if (_.isUndefined(options)) {
    var options = {};
  }
  var op = _.defaults(options, defaultOptions);
  room.options = op;
  if (!_.isString(op.name) || op.name.length < 1) {
    logger.error('invalid room name');
    // TODO: throw exception
    return;
  }

  room.status = 'init';
  room.router = new Router();

  function prepareCheckoutTimer(r_room) {
    if (r_room.options.expiration > 0) {
      r_room.checkoutTimer = setInterval(function onTimeout() {
        var stampDiff = Date.now() - r_room.options.lastCheckoutTimestamp;
        if ( stampDiff < r_room.options.expiration * 3600 * 1000 ) {
          return;
        };

        logger.trace('Room', r_room.options.name, 'timeout and will be deleted.');
        r_room.options.permanent = false;
        if (r_room.currentLoad() > 0) {
          r_room.options.emptyclose = true;
        }else{
          r_room.close();
        }       
      },
      2 * 3600 * 1000);
    }
  }

  async.auto({
    'load_salt': function(callback) {
      if (room.options.salt.length < 1) {
        if (globalSalt.length < 1) {
          logger.error('Salt load error!');
          room.options.salt = new Buffer('temp salt');
        }else{
          room.options.salt = globalSalt;
        }
      }
      callback();
    },
    'gen_signedkey': ['load_salt', function(callback) {
      if (room.options.recovery != true) {
        var hash_source = room.options.name + room.options.salt;
        var hashed = crypto.createHash('sha1');
        hashed.update(hash_source, 'utf8');
        room.signed_key = hashed.digest('hex');
      }else{
        room.signed_key = room.options.key;
      }
      
      callback();
    }],
    'start_checkTimer': function(callback){
      prepareCheckoutTimer(room);
      callback();
    },
    'ensure_dir': function(callback){
      fs.exists(globalConf['room']['path'],
      function(exists) {
        if (!exists) {
          fs.mkdir(globalConf['room']['path'], function(err){
            if (err) {
              logger.error('Error while creating dir for room: ', err);
              callback(err);
            };
            callback();
          });
        }
        callback();
      });
    },
    'gen_fileNames': ['ensure_dir', function(callback){
      if (room.options.recovery === true) {
        room.archive = room.options.archive;
      }else{
        room.archive = function() {
          var hash = crypto.createHash('sha1');
          hash.update(room.options.name, 'utf8');
          hash = hash.digest('hex');
          return globalConf['room']['path'] + hash + '.data';
        } ();
      }
      callback();
      
    }],
    'create_radio': ['gen_fileNames', function(callback){
      room.radio = new Radio({
        'filename': room.archive,
        'recovery': room.options.recovery
      });
      room.radio.once('ready', callback);
    }],
    'install_router': ['create_radio', function(callback){
      room.router.reg('request', 'login',
      function(cli, obj) {
        var r_room = room;
        // name check
        if (!obj['name'] || !_.isString(obj['name'])) {
          var ret = {
            response: 'login',
            type: 'command',
            result: false,
            errcode: 301
          };
          logger.log(ret);
          var jsString = common.jsonToString(ret);
          r_room.socket.sendData(cli, new Buffer(jsString));
          return;
        }
        // password check
        if (r_room.options.password.length > 0) {
          if (!obj['password'] || !_.isString(obj['password']) || obj['password'] != r_room.options.password) {
            var ret = {
              response: 'login',
              type: 'command',
              result: false,
              errcode: 302
            };
            logger.log(ret);
            var jsString = common.jsonToString(ret);
            r_room.socket.sendData(cli, new Buffer(jsString));
            return;
          }
        }

        // if server is too busy
        if (toobusy()) {
          var ret = {
            response: 'login',
            type: 'command',
            result: false,
            errcode: 305
          };
          logger.log(ret);
          var jsString = common.jsonToString(ret);
          r_room.socket.sendData(cli, new Buffer(jsString));
          return;
        };
        // send info
        var ret = {
          response: 'login',
          type: 'command',
          result: true,
          info: {
            'historysize': r_room.radio.dataLength(),
            'size': r_room.options.canvasSize,
            'clientid': function() {
              var hash = crypto.createHash('sha1');
              hash.update(r_room.options.name + obj['name'] + r_room.options.salt + (new Date()).getTime(), 'utf8');
              hash = hash.digest('hex');
              if (cli) {
                cli['clientid'] = hash;
              }
              return hash;
            } ()
          }
        };
        logger.log(ret);
        var jsString = common.jsonToString(ret);
        r_room.socket.sendData(cli, new Buffer(jsString));

        cli['username'] = obj['name'];
        cli['anonymous_login'] = true;
        cli.emit('login');
        return;
      },
      room).reg('request', 'close',
      function(cli, obj) {
        var r_room = room;
        // check signed key
        if (!obj['key'] || !_.isString(obj['key'])) {
          var ret = {
            response: 'close',
            type: 'command',
            result: false
          };
          logger.log(ret);
          var jsString = common.jsonToString(ret);
          r_room.socket.sendData(cli, new Buffer(jsString));
        } else {
          if (obj['key'].toLowerCase() == r_room.signed_key.toLowerCase()) {
            var ret = {
              response: 'close',
              type: 'command',
              result: true
            };
            logger.log(ret);
            var jsString = common.jsonToString(ret);
            r_room.socket.sendData(cli, new Buffer(jsString));
            var ret_all = {
              action: 'close',
              'info': {
                reason: 501
              }
            };
            jsString = common.jsonToString(ret_all);
            logger.log(jsString);
            r_room.socket.broadcastData(new Buffer(jsString));
            r_room.options.emptyclose = true;
            r_room.options.permanent = false;
          }
        }
      },
      room).reg('request', 'clearall',
      function(cli, obj) {
        var r_room = room;
        if (!obj['key'] || !_.isString(obj['key'])) {
          var ret = {
            response: 'clearall',
            type: 'command',
            result: false
          };
          var jsString = common.jsonToString(ret);
          r_room.socket.sendData(cli, new Buffer(jsString));
        } else {
          if (obj['key'].toLowerCase() == r_room.signed_key.toLowerCase()) {
            r_room.radio.dataRadio.prune();
            var ret = {
              response: 'clearall',
              type: 'command',
              result: true
            };
            var jsString = common.jsonToString(ret);
            r_room.socket.sendData(cli, new Buffer(jsString));
            var ret_all = {
              action: 'clearall',
            };
            jsString = common.jsonToString(ret_all);
            r_room.socket.broadcastData(new Buffer(jsString));
          } else {
            var ret = {
              response: 'clearall',
              type: 'command',
              result: false
            };
            var jsString = common.jsonToString(ret);
            r_room.socket.sendData(cli, new Buffer(jsString));
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
        if (!_.findWhere(r_room.socket.clients, {
          'clientid': obj['clientid']
        })) {
          return;
        }

        var people = [];
        _.each(r_room.socket.clients,
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
          type: 'command',
          result: true,
          onlinelist: people
        };
        logger.log(ret);
        var jsString = common.jsonToString(ret);
        r_room.socket.sendData(cli, new Buffer(jsString));
      },
      room).reg('request', 'checkout',
      function(cli, obj) {
        var r_room = room;
        if (!obj['key'] || !_.isString(obj['key'])) {
          var ret = {
            response: 'checkout',
            type: 'command',
            result: false,
            errcode: 701
          };
          logger.log(ret);
          var jsString = common.jsonToString(ret);
          r_room.socket.sendData(cli, new Buffer(jsString));
        }
        if (obj['key'].toLowerCase() == r_room.signed_key.toLowerCase()) {
          r_room.options.lastCheckoutTimestamp = Date.now();
          r_room.emit('checkout');
          var ret = {
            response: 'checkout',
            type: 'command',
            result: true,
            cycle: r_room.options.expiration ? r_room.options.expiration: 0
          };
          logger.log(ret);
          var jsString = common.jsonToString(ret);
          r_room.socket.sendData(cli, new Buffer(jsString));
        }
      },
      room);
      callback();
    }],
    'init_socket': ['install_router', 'create_radio', function(callback){
      room.socket = new socket.SocketServer();
      room.socket.maxConnections = room.options.maxLoad;
      room.socket.on('connection',
      function(con) {
        async.auto({
          'send_to_clusters': function(callback){
            if (cluster.isWorker) {
              cluster.worker.send({
                'message': 'loadchange',
                'info': {
                  'name': room.options.name,
                  'currentLoad': room.currentLoad()
                }
              });
            };
            callback();
          },
          'wait_login': function(callback){
            con.once('login', callback);
          },
          'send_announcement': ['wait_login', function(callback){
            room.socket.sendData(con, common.jsonToString({
              'type': 'message',
              'content': globalConf['room']['serverMsg']
            }));
            callback();
          }],
          'send_room_welcome_msg': ['send_announcement', function(callback){
            // TODO: use cmd channal
            // var send_msg = '<p style="font-weight:bold;">欢迎使用'+
            //             '<a href="http://mrspaint.com">茶绘君</a>。<br/>'+
            //             '如果您在使用中有任何疑问，'+
            //             '请在<a href="http://tieba.baidu.com/f?kw=%B2%E8%BB%E6%BE%FD">茶绘君贴吧</a>留言。</p>\n';
            // room.notify(con, send_msg);
            if (room.options.welcomemsg.length) {
              room.socket.sendData(con, common.jsonToString({
                'type': 'message',
                'content': room.options.welcomemsg + '\n'
              }));
            }
            callback();
          }],
          'hook_to_radio': ['send_room_welcome_msg', function(callback){
            room.radio.addClient(con);
            callback();
          }]
        });

        con.once('close', function() {
          if (room.options.emptyclose) {
            if (room.currentLoad() < 1) { // when exit, still connected on.
              room.close();
            }
          }
          if (cluster.isWorker) {
            cluster.worker.send({
              'message': 'loadchange',
              'info': {
                'name': room.options.name,
                'currentLoad': room.currentLoad()
              }
            });
          }
        });
      }).on('message', function(client, message, datapack) {
        var obj = common.stringToJson(message);
        if ( obj['type'] && _.isString(obj['type']) ) {
          switch (obj['type']) {
            case 'command':
              room.router.message(client, obj);
            break;
            case 'data': // fall-through
            case 'message':
              if(client['anonymous_login'] === true){
                room.radio.write(datapack, client);
              }
              break;
            default:
              // ignore other unknown types
            break;
          }
        }
      }).on('listening', callback);
      room.socket.listen(room.options.port, '::');
    }]
  }, function(er){
    if (er) {
      logger.error('Error while creating Room: ', er);
      room.options.permanent = false;
      room.close();
    }else{
      var tmpF = function() {
        room.emit('create', {
          'port': room.socket.address().port,
          'maxLoad': room.options.maxLoad,
          'currentLoad': room.currentLoad(),
          'name': room.options.name,
          'key': room.signed_key,
          'private': room.options.password.length > 0
        });
        room.emit('checkout');

        function uploadCurrentInfo() {
          if (cluster.isWorker) {
            cluster.worker.send({
              'message': 'roominfo',
              'info':{
                'name': room.options.name,
                'port': room.socket.address().port,
                'maxLoad': room.options.maxLoad,
                'currentLoad': room.currentLoad(),
                'private': room.options.password.length > 0,
                'timestamp': (new Date()).getTime()
              }
            });
          };
        }
        room.uploadCurrentInfoTimer = setInterval(uploadCurrentInfo, 1000*10);
      };
      process.nextTick(tmpF);
      room.status = 'running';
    }
  });

}

util.inherits(Room, events.EventEmitter);

Room.prototype.start = function() {
  return this;
};

Room.prototype.port = function() {
  return this.socket.address().port;
};

Room.prototype.close = function() {
  var self = this;
  if (self.status == 'closed') {
    return self;
  }
  
  logger.log('Room', self.options.name, 'is closed.');
  if (self.uploadCurrentInfoTimer) {
    clearInterval(self.uploadCurrentInfoTimer);
  };

  if (self.checkoutTimer) {
    clearInterval(self.checkoutTimer);
  };

  process.nextTick(function(){
    self.emit('close');
    if (cluster.isWorker) {
      cluster.worker.send({
        'message': 'roomclose',
        'info':{
          'name': self.options.name
        }
      })
    }
  });

  if (self.socket) {
    try {
      self.socket.close();
    } catch (e) {
      logger.error('Cannot close socket:', e);
    }
    self.socket = null;
    
  }

  if (self.radio) {
    if (!self.options.permanent) {
      self.radio.removeFile();
    }
    self.radio.cleanup();
    self.radio = null;
  }

  if (!self.options.permanent) {
    process.nextTick(function(){
      self.emit('destroyed');
    });
  }

  self.status = 'closed';
  
  return this;
};

Room.prototype.currentLoad = function() {
  // do not count socket.clients directly because it's a public socket
  if (this.status == 'running') {
    return (_.filter(this.socket.clients, function(cli){ 
        return cli['username'] && cli['clientid']; 
      })).length;
  }else{
    return 0;
  }
  
};

Room.prototype.notify = function(con, content) {
  var self = this;
  var sendContent = {
    action: 'notify',
    'content': content
  };
  self.socket.sendData(con, common.jsonToString(sendContent));
  logger.debug('socket: ', self.socket, sendContent);
};

Room.prototype.bradcastMessage = function(content) {
  var self = this;
  var sendContent = {
    action: 'notify',
    'content': content
  };
  self.socket.broadcastData(common.jsonToString(sendContent));
};

module.exports = Room;