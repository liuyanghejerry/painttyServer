var util = require("util");
var net = require('net');
var Buffers = require('buffers');
var _ = require('underscore');
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
		cli.dataSize = 0;
		cli.setKeepAlive(true, 60*1000);
		cli.setNoDelay(true);
		cli.on('connect', function() {
			server.clients.push(cli);
		}).on('close', function() {
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
			console.log('Error with socket!');
			console.log(err);
			cli.destroy();
		});
	}).on('error', function(err) {
		console.log('Error with server!');
		console.log(err);
	});
}

util.inherits(SocketServer, net.Server);

SocketServer.prototype.sendData = function (cli, data) {
	var server = this;
	if(this.options.compressed === true){
		common.qCompress(data, function(d) {
			cli.write( server.pack(d, true) );
		});
	}else{
		cli.write( server.pack(data, false) );
	}
	
};

SocketServer.prototype.pack = function (data, compressed) {
	var len = data.length + 1;
	var c1, c2, c3, c4;
	var tmp = new Buffer(5);
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
	tmp[4] = compressed?1:0;
	return Buffer.concat([tmp, data], 5+data.length);
};

SocketServer.prototype.onData = function(cli, buffer) {
	var server = this;
	function tmpF() {
		if(cli.commandStarted){
			if(cli.socketBuf.length >= cli.dataSize && cli.dataSize != 0) {
				var buf = cli.socketBuf.toBuffer();
				var isCompressed = (buf[0] & 0x1 === 1)?true:false;
				var dbuf = cli.socketBuf.slice(1);
				if(isCompressed){
					var repacked = server.pack(dbuf, true);
					server.emit('datapack', cli, repacked);
					
					if(_.isFunction(server.options.useAlternativeParser)){
						common.qUncompress(dbuf, function(d, err) {
							if(err){
								return;
							}
							server.options.useAlternativeParser(cli, d);
						});
					}
					if(server.options.autoBroadcast) {
						_.each(server.clients, function(c) {
							if(c != cli) c.write(repacked);
						});
					}
				}else{
					var repacked = server.pack(dbuf, false);
					server.emit('datapack', cli, repacked);
						
					if(_.isFunction(server.options.useAlternativeParser)){
						server.options.useAlternativeParser(cli, repacked);
					}
					
					if(server.options.autoBroadcast) {
						_.each(server.clients, function(c) {
							if(c != cli) c.write(repacked);
						});
					}
				}
				cli.socketBuf = new Buffers();
				cli.dataSize = 0;
				cli.commandStarted = false;
			}else{
				cli.socketBuf.push(buffer);
				return;
			}
		}else{
			if(buffer.length < 5 ) {
				cli.socketBuf.push(buffer);
				return;
			}else{
				if(!cli.commandStarted) {
					cli.socketBuf.push(buffer);
				}
				cli.commandStarted = true;
				var size = cli.socketBuf.slice(0, 4);
				cli.dataSize = (size[0] << 24) + (size[1] << 16) + (size[2] << 8) + size[3];
				cli.socketBuf.splice(0, 4);
				tmpF();
			}
		}
	};
	tmpF();
};

SocketServer.prototype.kick = function(cli) {
	var server = this;
	cli.end();
};

exports.SocketServer = SocketServer;
