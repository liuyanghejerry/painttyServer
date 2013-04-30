var util = require("util");
var net = require('net-cluster');
var Buffers = require('buffers');
var _ = require('underscore');
var logger = require('tracer').console();
var common = require('./common.js');


function SocketServer(options) {
  net.Server.call(this);
  
  var defaultOptions = {
    autoBroadcast: true,
    waitComplete: true,
    useAlternativeParser: false,
    compressed: true,
    indebug: false
  };
  
  if(_.isUndefined(options)) {
    var options = {};
  }
  var op = _.defaults(options, defaultOptions);
  
  var server = this;
  server.options = op;
  server.clients = [];
  server.on('connection', function(cli) {
    cli.socketBuf = new Buffers();
    cli.commandStarted = false;
    cli.isCompressed = false;
    cli.dataSize = 0;
    cli.setKeepAlive(true);
    server.clients.push(cli);
    cli.on('close', function() {
      var index = server.clients.indexOf(cli);
      server.clients.splice(index, 1);
    }).on('data', function (buf) {
      server.emit('data', cli, buf);
      if(op.waitComplete) {
        server.onData(cli, buf);
      }else{
        if(op.autoBroadcast) {
          _.each(server.clients, function(c) {
            if(c != cli) c.write(buf);
          });
        }
        if(_.isFunction(op.useAlternativeParser)) {
          server.onData(cli, buf);
        }
      }
    }).on('error', function(err) {
      logger.log('Error with socket!');
      logger.log(err);
      cli.isInError = true;
      cli.destroy();
      delete cli['socketBuf'];
      delete cli['dataSize'];
    });
  }).on('error', function(err) {
    logger.log('Error with server!');
    logger.log(err);
  });
}

util.inherits(SocketServer, net.Server);

SocketServer.prototype.sendData = function (cli, data) {
  var server = this;
  if(this.options.compressed === true){
    common.qCompress(data, function(d) {
      var tmpData = new Buffer(1);
      tmpData[0] = 0x1;
      var r_data = Buffer.concat([tmpData, d]);
      cli.write( server.pack(r_data) );
    });
  }else{
    var tmpData = new Buffer(1);
    tmpData[0] = 0x0;
    var r_data = Buffer.concat([tmpData, data]);
    cli.write( server.pack(r_data) );
  }
};

SocketServer.prototype.broadcastData = function (data) {
  var server = this;
  _.each(server.clients, function(cli) {
    server.sendData(cli, data);
  });
};

SocketServer.prototype.pack = function (data) {
  var len = data.length;
  var c1, c2, c3, c4;
  var tmp = new Buffer(4);
  c1 = len & 0xFF;
  len >>= 8;
  c2 = len & 0xFF;
  len >>= 8;
  c3 = len & 0xFF;
  len >>= 8;
  c4 = len & 0xFF;
  tmp[0] = c4;
  tmp[1] = c3;
  tmp[2] = c2;
  tmp[3] = c1;
  return Buffer.concat([tmp, data], 4+data.length);
};


SocketServer.prototype.onData = function(cli, buffer) {
  var server = this;
  if(cli.isInError === true){
    logger.log('In error client data skipped.');
    return;
  }
  cli.socketBuf.push(buffer);
  
  function GETPACKAGESIZEFROMDATA() {
    var pg_size_array = cli.socketBuf.splice(0, 4);
    pg_size_array = pg_size_array.toBuffer();
    var pg_size = (pg_size_array[0] << 24) + (pg_size_array[1] << 16) + (pg_size_array[2] << 8) + pg_size_array[3];
    return pg_size;
  }
  
  function READRAWBYTES(size) {
    var data = cli.socketBuf.splice(0, size);
    data = data.toBuffer();
    return data;
  }
  
  function REBUILD(rawData) {
    return server.pack(rawData);
  }
  
  function GETFLAG(pkgData) {
    return pkgData[0] === 0x1;
  }
  
  while (true) {
    if(cli.isInError === true){
      logger.log('In error client data skipped.');
      return;
    }
    
    if(cli.dataSize === 0){
      if (cli.socketBuf.length < 4)
        return;
      cli.dataSize = GETPACKAGESIZEFROMDATA();
    }
    if (cli.socketBuf.length < cli.dataSize)
      return;
    var packageData = READRAWBYTES(cli.dataSize);
    var isCompressed = GETFLAG(packageData);
    var dataBlock = packageData.slice(1);
    
    if(_.isFunction(server.options.useAlternativeParser)){
      if(isCompressed) {
        common.qUncompress(dataBlock, function(d, err) {
          if(err){
            logger.log(err);
            return;
          }
          server.options.useAlternativeParser(cli, d);
        });
      }else{
        server.options.useAlternativeParser(cli, dataBlock);
      }
      
    }
    
    var repacked = REBUILD(packageData);
    server.emit('datapack', cli, repacked);
    
    if(server.options.autoBroadcast) {
      _.each(server.clients, function(c) {
        if(c != cli) c.write(repacked);
      });
    }
    
    cli.dataSize = 0;
  }
};

SocketServer.prototype.kick = function(cli) {
  var server = this;
  cli.end();
};

exports.SocketServer = SocketServer;
