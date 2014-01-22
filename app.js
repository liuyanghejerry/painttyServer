var cluster = require('cluster');
var numCPUs = require('os').cpus().length;
// var numCPUs = 4;
var heapdump = require('heapdump');
var _ = require('underscore');
var domain = require('domain');
var toobusy = require('toobusy');
var async = require('async');
var mongoose = require('mongoose');
var common = require('./common.js');
var Router = require("./router.js");
var RoomManager = require('./roommanager.js');
var socket = require('./streamedsocket.js');
var CpuCare = require('./cpucare.js');
var logger = common.logger;
var globalConf = common.globalConf;
// var express = require('express');
// var httpServer = express();

// var agent = require('webkit-devtools-agent');

if (cluster.isMaster) {
  var localSocket = null;
  var router = null;
  process.title = 'painttyServer master';
  async.auto({
    'init_db': function(callback) {
      mongoose.connect(globalConf['database']['connectionString']);
      var db = mongoose.connection;
      db.on('error', function(er) {
        logger.error('connection error:', er);
        callback(er);
      });
      db.once('open', function () {
        callback();
      });
    },
    'init_local_socket': ['init_db', function(callback){
      router = new Router();

      router.reg('request', 'broadcast', function(cli, obj){
        var msg = obj['msg'];
        if (!_.isString(msg)) {
          var ret = {
            'response': 'broadcast',
            'result': false
          };
          return;
        };
        var send_to_workers = {
          message: 'broadcast',
          content: msg
        };
        var w = cluster.workers;
        if (w[0]) {
          w[0].send(send_to_workers);
        };
        
        var ret = {
          'response': 'broadcast',
          'result': true
        };
        var jsString = common.jsonToString(ret);
        cli.sendData(cli, new Buffer(jsString));
      });

      localSocket = new socket.SocketServer({'record': false, 'keepAlive': false});

      localSocket.on('message', function(client, data) {
        var obj = common.stringToJson(data);
        logger.log(obj);
        self.router.message(client, obj);
      }).on('error', function(err){
        logger.error(err);
      });
      localSocket.listen('56565', '127.0.0.1');
      callback();
    }],
    'fork_child': ['init_local_socket', function(callback){
      // Fork workers.
      function forkWorker(memberId) {
        var worker = cluster.fork({'memberId': memberId});
        worker.memberId = memberId;
        worker.on('message', function(msg) {
          _.each(cluster.workers, function(ele, index, list) {
            ele.send(msg);
          });
        });
        // attach cpu usage monitor
        var c_care = new CpuCare({
          target: worker.process.pid,
          mark: 90,
          cycle: 5*60*1000 // check per 5 min
        });
        c_care.once('processkilled', function(killed_info) {
          logger.warn('worker is killed because of cpu usage', killed_info);
        });
      }

      for (var i = 0; i < numCPUs; i++) {
        forkWorker(i);
      }

      cluster.on('exit', function(worker, code, signal) {
        if(worker.memberId){
          logger.error('Worker with memberId', worker.memberId, 'died');
          forkWorker(worker.memberId);
        }
      });

      callback();
    }]
  }, function(er, re){
    if (er) {
      logger.error('Error while init master process: ', er);
    };
  });
  
} else {
  var d1 = domain.create();
  var roomManager;
  d1.run(function() {
    var memberId = 0;
    if (process.env['memberId']) {
      memberId = parseInt(process.env['memberId'], 10);
    }else{
      logger.error('Worker process inited without memberId!');
    }

    process.title = 'painttyServer child, memberId:' + memberId;

    roomManager = new RoomManager({
      localId: memberId, 
      name: 'rmmgr', 
      pubPort: globalConf['manager']['publicPort']
    });

    process.on('SIGINT', function() {
      if (roomManager) {
        roomManager.stop();
      };
      toobusy.shutdown();
      process.exit();
    });

  });
  d1.on('error', function(er1) {
    logger.error('Error with RoomManager:', er1);
    if(er1.code == 'EADDRINUSE'){
      return;
    }
    try {
      // make sure we close down within 30 seconds
      var killtimer = setTimeout(function() {
        process.exit(1);
      }, 30000);
      // But don't keep the process open just for that!
      killtimer.unref();

      if (roomManager) {
        var error_notify = '<p style="font-weight:bold;color:red;">完蛋了！！'+
                  '检测到服务端发生了一些故障，赶快逃离吧！！。</p>\n';
        roomManager.localcast(error_notify);
        roomManager.stop();
      };
    } catch(er) {
      logger.error('Cannot gently close RoomManager:', err);
      toobusy.shutdown();
      process.exit(1);
    }
  });
}


// httpServer.get('/', function(req, res) {
    // var list = [];
    // _.each(roomManager.roomObjs, function(item) {
        // if(_.isUndefined(item)) return;
        // var r = {
            // cmdport: item.cmdSocket.address().port,
            // // serveraddress: roomManager.pubServer.address().address,
            // maxload: item.options.maxLoad,
            // currentload: item.currentLoad(),
            // name: item.options.name,
            // 'private': item.options.password.length > 0
        // };
        // list.push(r);
    // });
    // list.push(roomManager.pubServer.address());
    // var m = JSON.stringify(list);
    // res.send('<h2>Hello from Mr.Paint</h2><p>Here is some debug info: </p>'+m);
// });

// httpServer.listen(39797);
