var cluster = require('cluster');
var numCPUs = require('os').cpus().length;
var heapdump = require('heapdump');
var domain = require('domain');
var toobusy = require('toobusy');
var async = require('async');
var mongoose = require('mongoose');
var common = require('./libs/common.js');
var RoomManager = require('./roommanager.js');
var socket = require('./libs/streamedsocket.js');
var CpuCare = require('./libs/cpucare.js');
var TypeChecker = require('./libs/types.js');
var logger = common.logger;
var globalConf = common.globalConf;

// var agent = require('webkit-devtools-agent');

if (cluster.isMaster) {
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
    'fork_child': ['init_db', function(callback){
      // Fork workers.
      function forkWorker(memberId) {
        var worker = cluster.fork({'memberId': memberId});
        worker.memberId = memberId;
        worker.on('message', function(msg) {
          for (var wid in cluster.workers) {
            cluster.workers[wid].send(msg);
          }
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
