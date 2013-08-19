var events = require('events');
var cluster = require('cluster');
var util = require("util");
var crypto = require('crypto');
var _ = require('underscore');
var async = require('async');
var toobusy = require('toobusy');
var common = require('./common.js');
var socket = require('./streamedsocket.js');
var SocketClient = socket.SocketClient;
var Router = require("./router.js");
var logger = common.logger;
var globalConf = common.globalConf;
var globalSaltHash = common.globalSaltHash;

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
    return;
  }

  room.status = 'init';
  room.router = new Router();

  function roomTimeout(room_ref) {
    var stampDiff = Date.now() - room_ref.options.lastCheckoutTimestamp;
    if ( stampDiff < room_ref.options.expiration * 3600 * 1000 ) {
      return false;
    };

    logger.trace('Room', room_ref.options.name, 'timeout and will be deleted.');
    room_ref.options.permanent = false;
    if (room_ref.currentLoad() > 0) {
      room_ref.options.emptyclose = true;
    }else{
      // process.nextTick(room_ref.close);
      room_ref.close();
    }
    return true;
  }

  if(roomTimeout(room)) {
    return;
  }

  function prepareCheckoutTimer(r_room) {
    if (r_room.options.expiration > 0) {
      var toCall = _.partial(roomTimeout, r_room);
      r_room.checkoutTimer = setInterval(toCall, 2 * 3600 * 1000);
    }
  }

  async.auto({
    'load_salt': function(callback) {
      if (room.options.salt.length < 1) {
        if (globalSaltHash.length < 1) {
          logger.error('Salt load error!');
          room.options.salt = new Buffer('temp salt');
        }else{
          room.options.salt = globalSaltHash;
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
      common.ensureDir(globalConf['room']['path'], callback);
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
    'install_router': ['gen_fileNames', function(callback){
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
          cli.sendCommandPack(ret);
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
            r_room.sendCommandTo(cli, ret);
            return;
          }
        }

        // if server is too busy
        if (toobusy()) {
          var ret = {
            response: 'login',
            result: false,
            errcode: 305
          };
          logger.log(ret);
          r_room.sendCommandTo(cli, ret);
          return;
        };
        // send info
        var ret = {
          response: 'login',
          result: true,
          info: {
            'historysize': r_room.socket.archiveLength(),
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
        r_room.sendCommandTo(cli, ret);

        cli['username'] = obj['name'];
        process.nextTick(function(){
          cli.emit('login');
        });
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
          r_room.sendCommandTo(cli, ret);;
        } else {
          if (obj['key'].toLowerCase() == r_room.signed_key.toLowerCase()) {
            var ret = {
              response: 'close',
              result: true
            };
            logger.log(ret);
            r_room.sendCommandTo(cli, ret);
            var ret_all = {
              action: 'close',
              'info': {
                reason: 501
              }
            };
            jsString = common.jsonToString(ret_all);
            logger.log(jsString);
            r_room.socket.broadcastData(new Buffer(jsString), SocketClient.PACK_TYPE['COMMAND']);
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
            result: false
          };
          r_room.sendCommandTo(cli, ret);
        } else {
          if (obj['key'].toLowerCase() == r_room.signed_key.toLowerCase()) {
            r_room.socket.pruneArchive();
            var ret = {
              response: 'clearall',
              result: true
            };
            r_room.sendCommandTo(cli, ret);
            var ret_all = {
              action: 'clearall',
            };
            jsString = common.jsonToString(ret_all);
            r_room.socket.broadcastData(new Buffer(jsString), SocketClient.PACK_TYPE['COMMAND']);
          } else {
            var ret = {
              response: 'clearall',
              result: false
            };
            r_room.sendCommandTo(cli, ret);
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
          result: true,
          onlinelist: people
        };
        logger.log(ret);
        r_room.sendCommandTo(cli, ret);
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
          r_room.socket.sendCommandTo(cli, ret);
        }
        if (obj['key'].toLowerCase() == r_room.signed_key.toLowerCase()) {
          r_room.options.lastCheckoutTimestamp = Date.now();
          r_room.emit('checkout');
          var ret = {
            response: 'checkout',
            result: true,
            cycle: r_room.options.expiration ? r_room.options.expiration: 0
          };
          logger.log(ret);
          r_room.sendCommandTo(cli, ret);
        }
      },
      room);
      callback();
    }],
    'init_socket': ['install_router', function(callback){
      room.socket = new socket.SocketServer({
        'archive': room.archive,
        'recovery': room.options.recovery,
        'record': true
      });

      // if port is in use, we retry 5 times
      var bindRetryFailed = _.after(5, function(){
        logger.warn('Port %s in use, reached retry limit. Now try to listen a random port'
          , room.options.port);
        room.socket.close();
        room.socket.listen(0, '::');
        return true;
      });

      // room.socket.maxConnections = room.options.maxLoad;
      room.socket.on('newclient',
      function(client) {
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
            client.once('login', function(){
              client['anonymous_login'] = true;
              callback();
            });
          },
          'send_announcement': ['wait_login', function(callback){
            var ret = {
              'action': 'notify',
              'content': globalConf['room']['serverMsg']
            };

            // NOTICE: don't use sendCommandTo, since the client is not added to radio yet.
            client.sendCommandPack(new Buffer(common.jsonToString(ret)));
            callback();
          }],
          'send_room_welcome_msg': ['send_announcement', function(callback){
            if (room.options.welcomemsg.length) {
              var ret = {
                'content': room.options.welcomemsg + '\n'
              };
              client.sendMessagePack(new Buffer(common.jsonToString(ret)));
            }
            // FIXEME: need a way to precisely seperate welcome messages and data in archive later
            setTimeout(function(){
              client.emit('inroom');
            }, 5000);
            // setImmediate(function(){
            //   client.emit('inroom');
            // });
            callback();
          }]
        });

        client.once('close', function() {
          process.nextTick(function(){
            client.emit('outroom');
          });

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
        }).on('command', function(data) {
          var obj = common.stringToJson(data);
          room.router.message(client, obj);
        });
      }).on('listening', callback).on('error', function(err){
        if ( err.code == 'EADDRINUSE' && !bindRetryFailed() ) {
          logger.warn('Port %s in use, retrying...', room.options.port);
          setTimeout(function () {
            room.socket.close();
            room.socket.listen(room.options.port, '::');
          }, 1000);
        }
      });
      room.socket.listen(room.options.port, '::');
    }]
  }, function(er){
    if (er) {
      logger.error('Error while creating Room: ', er);
      room.options.permanent = false;
      room.close();
    }else{
      function onReady() {
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
      process.nextTick(onReady);
      room.status = 'running';
    }
  });

}

util.inherits(Room, events.EventEmitter);

Room.prototype.port = function() {
  return this.socket.address().port;
};

Room.prototype.sendCommandTo = function (client_ref, obj) {
  var room_ref = this;
  var jsString = common.jsonToString(obj);
  room_ref.socket.sendDataTo(client_ref, 
    new Buffer(jsString), 
    SocketClient['PACK_TYPE']['COMMAND']);

  jsString = null;
  obj = null;
  client_ref = null;
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
      self.socket.closeServer(!self.options.permanent);
    } catch (e) {
      logger.error('Cannot close socket:', e);
    }
    self.socket = null;
    
  }

  if (!self.options.permanent) {
    process.nextTick(function(){
      self.emit('destroyed');
    });
  }

  self.status = 'closed';
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

Room.prototype.notify = function(client_ref, content) {
  var self = this;
  var sendContent = {
    'action': 'notify',
    'content': content
  };

  self.sendCommandTo(client_ref, sendContent);
};

Room.prototype.notifyAll = function(content) {
  var self = this;
  var sendContent = {
    'action': 'notify',
    'content': content
  };
  sendContent = common.jsonToString(sendContent);
  sendContent = new Buffer(sendContent);
  self.socket.broadcastData(sendContent, SocketClient.PACK_TYPE['COMMAND']);
};

module.exports = Room;