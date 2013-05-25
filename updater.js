var events = require('events');
var cluster = require('cluster');
var numCPUs = require('os').cpus().length;
var util = require("util");
var fs = require('fs');
var _ = require('underscore');
var logger = require('tracer').dailyfile({root:'./logs/updater'});
var common = require('./common.js');
var Router = require("./router.js");
var socket = require('./socket.js');

function Updater(options) {
  events.EventEmitter.call(this);
  var self = this;

  var defaultOptions = new function() {
    var self = this;
    self.pubPort = 7071; // Default public port. This is used to connect with clients.
    self.log = false; // Log or not
    self.defFile = './updateinfo.js';
    self.changelog = {
      'en': './changelog/en.changelog',
      'zh_cn': './changelog/zh_cn.changelog',
      'zh_tw': './changelog/zh_tw.changelog',
      'ja': './changelog/ja.changelog'
    };
  };

  if (_.isUndefined(options)) {
    var options = {};
  }
  self.options = _.defaults(options, defaultOptions);

  // TODO: dynamic change version info and download url, etc
  // self.ConfWatcher = fs.watch(self.defFile, 
  //   {persistent: false}, 
  //   function(curr, prev) {
  //   //
  // });

self.currentVersion = {
  version: '0.31',
    // TODO: use a text file for changelog
    changelog: '',
    level: 4,
    url: {
      'windows': 'http://mrspaint.oss.aliyuncs.com/%E8%8C%B6%E7%BB%98%E5%90%9B_Alpha_x86.zip',
      'mac': 'http://mrspaint.oss.aliyuncs.com/%E8%8C%B6%E7%BB%98%E5%90%9B.app.zip'
    }
  };

  self.router = new Router();

  self.router.reg('request', 'check', function(cli, obj) {
    var platform = _.isString(obj['platform']) ? obj['platform'].toLowerCase() : 'windows';
    var language = _.isString(obj['language']) && _.has(self.options.changelog, obj['language']) 
    ? obj['language'].toLowerCase() : 'en';
    fs.readFile(self.options.changelog[language], 
      {
        encoding: 'utf8',
        flag: 'r'
      },
      function (err, data) {
        if (err) {
          logger.error(err);
          cli.end();
          return;
        }

        var info = {
          version: self.currentVersion['version'],
          changelog: data,
          level: self.currentVersion['level'],
          url: self.currentVersion['url']['windows']
        };

        if (platform == 'windows x86' || platform == 'windows x64') {
          info['url'] = self.currentVersion['url']['windows'];
        }else if (platform == 'mac') {
          info['url'] = self.currentVersion['url']['mac'];
        };

        var ret = {
          response: 'version',
          result: true,
          'info': info
        }

        var jsString = JSON.stringify(ret);
        self.pubServer.sendData(cli, new Buffer(jsString), function() {
          cli.end();
        });
      });
  });

self.pubServer = new socket.SocketServer({
  autoBroadcast: false,
  keepAlive: false,
  useAlternativeParser: function(cli, data) {
    var obj = JSON.parse(data);
    logger.log(obj);
    self.router.message(cli, obj);
  }
});

}

util.inherits(Updater, events.EventEmitter);

// module.exports = Updater;

Updater.prototype.start = function() {
  this.pubServer.listen(this.options.pubPort, '::');
};

Updater.prototype.stop = function() {
  this.pubServer.close();
};

function run() {
  if (cluster.isMaster) {
    // Fork workers.
    function forkWorker() {
      var worker = cluster.fork();
    }

    for (var i = 0; i < numCPUs/2+1; i++) {
      forkWorker();
    }

    cluster.on('exit', function(worker, code, signal) {
      logger.error('worker ', worker.process.pid, ' died');
      forkWorker();
    });
  } else {
    var upd = new Updater();
    upd.start();
  }

};

run();
