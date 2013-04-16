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

    // TODO
    self.pubSocket = new socket.SocketServer();
    self.regSocket = new socket.SocketServer();

}

util.inherits(Master, events.EventEmitter);

Master.prototype.start = function() {
    this.regSocket.listen(3031);
    this.pubSocket.listen(3030);
};