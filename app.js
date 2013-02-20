var common = require('./common.js');
var RoomManager = require('./roommanager.js');
var express = require('express');
var httpServer = express();

var roomManager = new RoomManager({name: 'rmmgr', pubPort: 3030});

roomManager.start();

httpServer.get('/', function(req, res) {
    res.send('<p>Hello from Mr.Paint</p>');
    res.send();
});

httpServer.listen(process.env.VCAP_APP_PORT || 9797);
