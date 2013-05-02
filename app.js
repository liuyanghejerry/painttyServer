var cluster = require('cluster');
var numCPUs = require('os').cpus().length;
var heapdump = require('heapdump');
var _ = require('underscore');
var logger = require('tracer').dailyfile({root:'./logs'});
var common = require('./common.js');
var RoomManager = require('./roommanager.js');
// var express = require('express');
// var httpServer = express();

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
  var roomManager = new RoomManager({name: 'rmmgr', pubPort: 7070});
  roomManager.start();
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
