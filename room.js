var events = require('events');
var fs = require('fs');
var util = require("util");
var crypto = require('crypto');
var Buffers = require('buffers');
var _ = require('underscore');
var bw = require ("buffered-writer");
var common = require('./common.js');
var socket = require('./socket.js');
var BufferedFile = require("./bufferedfile.js");

function Room(options) {
	events.EventEmitter.call(this);
	
	var defaultOptions = new function() {
		var self = this;
		self.name = '',
		self.password = '', // for private room
		self.maxLoad = 5,
		self.welcomemsg = '',
		self.emptyclose = false,
		self.permanent = false,
		self.expiration = 0, // 0 for limitless
		self.log = false
	};
	
	if(_.isUndefined(options)) {
		var options = {};
	}
	var op = _.defaults(options, defaultOptions);
	if(!_.isString(op.name) || op.name.length < 1) {
		common.log('valid name');
		// TODO: throw exception
		return;
	}
	op.logLocation = function() {
		var hash = crypto.createHash('sha1');
		hash.update(op.name, 'utf8');
		hash = hash.digest('hex');
		return './logs/rooms/'+hash+'.log';
	}();
	
	var room = this;
	room.workingSockets = 0;
	room.options = op;
	
	room.dataFile = function() {
		fs.exists('./data/room/', function (exists) {
		  if(!exists){
			fs.mkdirSync('./data/room/');
		  }
		});
		
		var hash = crypto.createHash('sha1');
		hash.update(op.name, 'utf8');
		hash = hash.digest('hex');
		return './data/room/'+hash+'.data';
	}();
	room.dataFileSize = 0;
	var bf = new BufferedFile({
				fileName: room.dataFile,
				bufferSize: 1024*1024*5,
				writeCycle: 0
			});
	
	room.msgFile = function() {
		fs.exists('./data/room/', function (exists) {
		  if(!exists){
			fs.mkdirSync('./data/room/');
		  }
		});
		
		var hash = crypto.createHash('sha1');
		hash.update(op.name, 'utf8');
		hash = hash.digest('hex');
		return './data/room/'+hash+'.msg';
	}();
	// room.msgFileSize = 0;
		
	room.dataSocket = new socket.SocketServer();
	room.dataSocket.maxConnections = room.options.maxLoad;
	room.dataSocket.on('data', function(cli, d) {
		// fs.appendFile(room.dataFile, d, function (err) {
		  // if (err) throw err;
		// });
		
		// bw.open(room.dataFile, {append: true})
			// .write(d)
			// .close();
		bf.append(d);
		
		room.dataFileSize += d.length;
		
	}).on('connection', function(con){
		// fs.exists(room.dataFile, function (exists) {
		  // if(exists){
			// fs.readFile(room.dataFile, function (err, data) {
			  // if (err) throw err;
			  // con.write(data);
			// });
		  // }
		// });
		bf.readAll(function(da) {
			con.write(da);
		});
	});
	
	room.msgSocket = new socket.SocketServer();
	room.msgSocket.maxConnections = room.options.maxLoad;
	room.msgSocket.on('data', function(cli, d) {
		fs.appendFile(room.msgFile, d, function (err) {
		  if (err) throw err;
		});
	}).on('connection', function(con){
		con.on('end', function() {
			if(room.options.emptyclose){
				if(room.currentLoad() <= 1){
					room.close();
				}
			}
		});
		// TODO: use cmd channal
		room.msgSocket.sendData(con, JSON.stringify({
			content: '欢迎使用茶绘君，我们的主页：http://mrspaint.com。\n'+
					'如果您在使用中有任何疑问，'+
					'请在茶绘君贴吧留言：http://tieba.baidu.com/f?kw=%B2%E8%BB%E6%BE%FD \n'
		}));
		if(room.options.welcomemsg.length) {
			room.msgSocket.sendData(con, JSON.stringify({
				content: room.options.welcomemsg+'\n'
			}));
		}
		fs.exists(room.msgFile, function (exists) {
		  if(exists){
			fs.readFile(room.msgFile, function (err, data) {
			  if (err) throw err;
			  con.write(data);
			});
		  }
		});
	});
	
	room.cmdSocket = new socket.SocketServer({
		useAlternativeParser: function(cli, buf) {
			// common.qUncompress(buf, function(re) {
				var obj = JSON.parse(buf.toString());
				var request = obj['request']?obj['request']:'';
				if( !_.isString(request) || request.length < 1 ) {
					return;
				}
				
				switch(request) {
					case 'login':
						// name check
						if(!obj['name'] || !_.isString(obj['name'])){
							var ret = {
								response: 'login',
								result: false,
								errcode: 301
							};
							var jsString = JSON.stringify(ret);
							room.cmdSocket.sendData(cli, new Buffer(jsString));
							return;
						}
						// password check
						if(room.options.password.length > 0){
							if(!obj['password'] || !_.isString(obj['password'])
							|| obj['password'] != room.options.password){
								var ret = {
									response: 'login',
									result: false,
									errcode: 302
								};
								var jsString = JSON.stringify(ret);
								room.cmdSocket.sendData(cli, new Buffer(jsString));
								return;
							}
						}
						// send info
						var ret = {
							response: 'login',
							result: true,
							info: {
								historysize: room.dataFileSize,
								dataport: room.ports().dataPort,
								msgport: room.ports().msgPort
								}
						};
						var jsString = JSON.stringify(ret);
						room.cmdSocket.sendData(cli, new Buffer(jsString));
						return;
						break;
				}
			// });
		}
	});
	room.cmdSocket.maxConnections = room.options.maxLoad;
	// room.cmdSocket.on('data', function(cli, d) {
		// fs.appendFile(room.cmdFile, d, function (err) {
		  // if (err) throw err;
		// });
	// }).on('connection', function(con){
		// fs.exists(room.cmdFile, function (exists) {
		  // if(exists){
			// fs.readFile(room.cmdFile, function (err, data) {
			  // if (err) throw err;
			  // con.write(data);
			// });
		  // }
		// });
	// });
	
	var tmpF = function() {
		room.workingSockets += 1;
		if(room.workingSockets >= 3) {
			room.emit('create', {
				cmdPort: room.cmdSocket.address().port,
				maxLoad: room.options.maxLoad,
				currentLoad: room.currentLoad(),
				name: room.options.name
			});
		}
	};
	
	room.dataSocket.on('listening', tmpF);
	room.cmdSocket.on('listening', tmpF);
	room.msgSocket.on('listening', tmpF);
}

util.inherits(Room, events.EventEmitter);

Room.prototype.start = function() {
	if(!this.options.permanent) {
		fs.unlink(this.dataFile);
		fs.unlink(this.msgFile);
	}
	this.cmdSocket.listen();
	this.dataSocket.listen();
	this.msgSocket.listen();
};

Room.prototype.ports = function() {
	return {
		cmdPort: this.cmdSocket.address().port,
		dataPort: this.dataSocket.address().port,
		msgPort: this.msgSocket.address().port
	};
};

Room.prototype.close = function() {
	console.log('Room.close()');
	this.emit('close');
	this.cmdSocket.close();
	this.dataSocket.close();
	this.msgSocket.close();
	if(!this.options.permanent) {
		fs.unlink(this.dataFile);
		fs.unlink(this.msgFile);
	}
};

Room.prototype.currentLoad = function() {
	// do not count cmdSocket because it's a public socket
	return Math.max(this.dataSocket.clients.length,
		this.msgSocket.clients.length);
};

module.exports = Room;