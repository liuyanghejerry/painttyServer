var events = require("events");
var util = require("util");
var crypto = require('crypto');
var Buffers = require('buffers');
var _ = require('underscore');
var common = require('./common.js');
var socket = require('./socket.js');
var Room = require('./room.js');
var RoomManager = require('./roommanager.js');

function Master(options) {
    events.EventEmitter.call(this);
    
    var self = this;
    
    var defaultOptions = new function() {
        var self = this;
        self.name = '',
        self.port = 0,
        self.log = false
    };
    
    if(_.isUndefined(options)) {
        var options = {};
    }
    var op = _.defaults(options, defaultOptions);

    op.logLocation = function() {
        var hash = crypto.createHash('sha1');
        hash.update(op.name, 'utf8');
        hash = hash.digest('hex');
        return './logs/room-manager/'+hash+'.log';
    }();
    
    self.rooms = [];
    self.pubSocket = new socket.SocketServer({
        autoBroadcast: false, 
        useAlternativeParser: function(cli, d) {
            common.qUncompress(d, function(re) {
                var obj = JSON.parse(re.toString());
                var request = obj['request']?obj['request']:'';
                if( !_.isString(request) || request.length <1 ) {
                    return;
                }
                switch (request) {
                    case 'roomlist':
                        var ret = {};
                        var list = [];
                        _.each(self.rooms, function(item) {
                            list.push(item);
                        });
                        ret['response'] = 'roomlist';
                        ret['roomlist'] = list;
                        ret['result'] = true;
                        var jsString = JSON.stringify(ret);
                        self.pubSocket.sendData(cli, new Buffer(jsString));
                        break;
                    case 'join':
                        cli.end();
                        break;
                    case 'newroom':
                        if(!obj['name']){
                            var ret = {
                                response: 'newroom',
                                result: false
                            };
                            var jsString = JSON.stringify(ret);
                            self.pubSocket.sendData(cli, new Buffer(jsString));
                            return;
                        }
                        var name = _.isString(obj['name'])?obj['name']:false;
                        if(!name) {
                            var ret = {
                                response: 'newroom',
                                result: false
                            };
                            var jsString = JSON.stringify(ret);
                            self.pubSocket.sendData(cli, new Buffer(jsString));
                            return;
                        }
                        room = new Room({name: obj['name']});
                        room.on('create', function(info) {
                            self.rooms.push(info);
                            var ret = {
                                response: 'newroom',
                                result: true
                            };
                            var jsString = JSON.stringify(ret);
                            self.pubSocket.sendData(cli, new Buffer(jsString));
                        });
                        room.start();
                        break;
                    default:
                        return;
                }
            });
        }
    });
    
    self.regSocket = new socket.SocketServer({
        autoBroadcast: false,
        useAlternativeParser: function(cli, d) {
            common.qUncompress(d, function(re) {
                var obj = JSON.parse(re.toString());
                var request = obj['request']?obj['request']:'';
                if( !_.isString(request) || request.length <1 ) {
                    return;
                }
                if(request == 'register'){
                    
                    var roomlist = _.isArray(obj['roomlist']);
                    if(!roomlist) {
                        var ret = {
                            response: 'register',
                            result: false,
                            message: 'Lack of room list'
                        };
                        var jsString = JSON.stringify(ret);
                        cli.sendData(new Buffer(jsString));
                        return;
                    }
                    
                    roomlist = obj['roomlist'];
                    for(var item in roomlist) {
                        var r = {};
                        r["address"] = cli.address().address;
                        r["port"] = cli.address().port;
                        if(!item["name"] || !_.isString(item["name"]) ) continue;
                        r["name"] = item["name"];
                        if( !item["maxCount"] || 
                            !_.isNumber(item["maxCount"]) || 
                            _.isNaN(item["maxCount"]) ) 
                                continue;
                        r["maxCount"] = parseInt(item["maxCount"], 10);
                        // TODO: change to a more fast way get current count
                        if( !item["currentCount"] || 
                            !_.isNumber(item["currentCount"]) || 
                            _.isNaN(item["currentCount"]) ) 
                                continue;
                        r["currentCount"] = parseInt(item["currentCount"], 10);
                        r["lastupdate"] = Date.now();
                        // TODO: add signature to validate
                        if(!self.rooms[r["address"]]) {
                            self.rooms[r["address"]] = {};
                        }
                        self.rooms[r["address"]][r["name"]] = r;
                    }
                    
                    var ret = {
                            response: 'register',
                            result: true
                    };
                    var jsString = JSON.stringify(ret);
                    cli.sendData(new Buffer(jsString));
                } else {
                    return;
                }
            });
        }
    
    });
    
    // TODO
    self.pubSocket = new socket.SocketServer({
        autoBroadcast: false, 
        useAlternativeParser: function(cli, d) {
            common.qUncompress(d, function(re) {
                var obj = JSON.parse(re.toString());
                var request = obj['request']?obj['request']:'';
                if( !_.isString(request) || request.length <1 ) {
                    return;
                }
                if(request == 'roomlist'){
                    var ret = {};
                    ret['response'] = 'roomlist';
                    ret['roomlist'] = function () { 
                        var re = [];
                        for (var item in self.rooms) {
                            re.push(item.roomInfo);
                        }
                        return re;
                    }();
                    ret['result'] = true;
                    var jsString = JSON.stringify(ret);
                    cli.sendData(new Buffer(jsString));
                } else if(request == 'join') {
                    cli.end();
                } else if(request == 'newroom') {
                    room = new Room.Room();
                    self.rooms.push(room);
                    var ret = {};
                    ret['response'] = 'newroom';
                    ret['result'] = true;
                    var jsString = JSON.stringify(ret);
                    cli.sendData(new Buffer(jsString));
                } else {
                    return;
                }
            });
        }
    });

}

util.inherits(Master, events.EventEmitter);

Master.prototype.start = function() {
    this.regSocket.listen(3031);
    this.pubSocket.listen(3030);
};