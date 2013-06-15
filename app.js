var cluster = require('cluster');
var numCPUs = require('os').cpus().length;
// var heapdump = require('heapdump');
var _ = require('underscore');
var domain = require('domain');
var logger = require('tracer').dailyfile({root:'./logs'});
var common = require('./common.js');
var RoomManager = require('./roommanager.js');
// var express = require('express');
// var httpServer = express();

// this makes it possible to run, even there's uncaught exception.
// FIXME: However, this may also drive program into unstable state. Only for debug.
// process.on('uncaughtException', function(err) {
//   logger.error(err);
// });

if (cluster.isMaster) {
  // Fork workers.
  function forkWorker() {
    var worker = cluster.fork();
    worker.on('message', function(msg) {
      _.forEach(cluster.workers, function(ele, index, list) {
            ele.send(msg);
      });
    });
  }

  for (var i = 0; i < numCPUs; i++) {
    forkWorker();
  }

  cluster.on('exit', function(worker, code, signal) {
    logger.error('worker ', worker.process.pid, ' died');
    forkWorker();
  });

  
} else {
  var d1 = domain.create();
  d1.on('error', function(er1) {
    logger.error('Error with RoomManager:', er1);
    process.exit(1);
  });
  d1.run(function() {
    var roomManager = new RoomManager({name: 'rmmgr', pubPort: 7070});
    var d = domain.create();
    d.on('error', function(err) {
      logger.error('Error in Worker:', err);
      try {
        // make sure we close down within 30 seconds
        var killtimer = setTimeout(function() {
          process.exit(1);
        }, 30000);
        // But don't keep the process open just for that!
        killtimer.unref();

        var error_notify = '<p style="font-weight:bold;color:red;">完蛋了！！'+
                  '检测到服务端发生了一些故障，赶快逃离吧！！。</p>\n';
        roomManager.localcast(error_notify);
        roomManager.stop();
      } catch(er) {
        logger.error('Cannot gently close RoomManager:', err);
      }
    });
    d.run(function() {
      roomManager.start();
    });
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
