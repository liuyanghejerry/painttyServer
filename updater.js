var events = require('events');
var cluster = require('cluster');
var numCPUs = require('os').cpus().length;
var util = require("util");
var fs = require('fs');
var domain = require('domain');
var express = require('express');
var async = require('async');
var _ = require('underscore');
var logger = require('tracer').dailyfile({root:'./logs/updater'});
var common = require('./libs/common.js');
var updateConf = require('./config/updateinfo.js');

function Updater(options) {
  events.EventEmitter.call(this);
  var self = this;
  self.changelog = {};
  function changelogCache (language, done) {
    if (self.changelog[language]) {
      return done(null, self.changelog[language]);
    }

    if (!updateConf.changelog[language]) {
      changelogCache(updateConf.defaultlang, done);
      return;
    }

    fs.readFile(
      updateConf.changelog[language],
      {
        encoding: 'utf8',
        flag: 'r'
      },
      function (err, data) {
        if (err) {
          logger.error(err);
          done(err);
        }
        self.changelog[language] = data;
        done(null, self.changelog[language]);
      }
    );
  }


  var defaultOptions = new function() {
    var self = this;
    self.pubPort = updateConf['pubPort']; // Default public port. This is used to connect with clients.
    self.changelog = updateConf['changelog'];
  };

  if (!options) {
    var options = {};
  }
  self.options = _.defaults(options, defaultOptions);

  // TODO: dynamic change version info and download url, etc

  self.currentVersion = {
    version: updateConf['version'],
    // TODO: use a text file for changelog
    changelog: '',
    level: updateConf['level'],
    url: updateConf['url']
  };

  function prepare_server() {
    self.server = express();
    self.server.use(express.compress());
    self.server.use(express.json());
    self.server.use(express.urlencoded());

    self.server.post('*', function (req, res) {
      var obj = req.body;
      var changelog = '';
      var body = '';
      console.log(obj);

      async.auto({
        'read_changelog': function (done) {
          var language = _.isString(obj['language']) ? obj['language'].toLowerCase() : 'en';

          changelogCache(language, function (err, cl) {
            changelog = cl;
            done(null);
          });
        },
        'combine_result': ['read_changelog', function (done) {
          var platform = _.isString(obj['platform']) ? obj['platform'].toLowerCase() : 'windows x86';
          var info = {
            'version': self.currentVersion['version'],
            'changelog': changelog,
            'level': self.currentVersion['level'],
            'url': self.currentVersion['url'][platform] ? self.currentVersion['url'][platform] : ''
          };

          var ret = {
            response: 'version',
            result: true,
            'info': info
          }
          body = common.jsonToString(ret);
          console.log(body);
          done(null);
        }]
      },
      function (err) {
        if (err) {
          logger.error(err);
        }
        res.setHeader('Content-Type', 'application/json');
        // NOTE: DO NOT use body.length, 
        // because body.length produces amount of characters, not bytes,
        // which may lead incorrect size when we have non-ascii characters.
        res.setHeader('Content-Length', Buffer.byteLength(body, 'utf-8'));
        res.end(body);
      });
    });

    self.server.get('*', function (req, res) {
      var changelog = '';
      var body = '';

      async.auto({
        'read_changelog': function (done) {
          var language = 'en';
          changelogCache(language, function (err, cl) {
            changelog = cl;
            done(null);
          });
        },
        'combine_result': ['read_changelog', function (done) {
          var platform = 'windows x86';
          var info = {
            'version': self.currentVersion['version'],
            'changelog': changelog,
            'level': self.currentVersion['level'],
            'url': self.currentVersion['url'][platform]
          };

          var ret = {
            response: 'version',
            result: true,
            'info': info
          }
          body = common.jsonToString(ret);
          done(null);
        }]
      },
      function (err) {
        if (err) {
          logger.error(err);
        }
        res.setHeader('Content-Type', 'application/json');
        // NOTE: DO NOT use body.length, 
        // because body.length produces amount of characters, not bytes,
        // which may lead incorrect size when we have non-ascii characters.
        res.setHeader('Content-Length', Buffer.byteLength(body, 'utf-8'));
        res.end(body);
      });
    });
  }

  var d = domain.create();
  d.on('error', function(er) {
    logger.error('Error in express server of Updater:', er);
  })
  .run(prepare_server);
}

util.inherits(Updater, events.EventEmitter);

Updater.prototype.start = function() {
  this.server.listen(updateConf.pubPort, '::');
};

Updater.prototype.stop = function() {
  this.server.close();
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

}

run();
