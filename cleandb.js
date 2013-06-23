var async = require('async');
var mongoose = require('mongoose');
// var _ = require('underscore');
var fs = require('fs');
var MongoSchema = require('./schema.js');
var common = require('./common.js');
var logger = require('tracer').colorConsole(); // common.logger;
var globalConf = common.globalConf;

var RoomModel = MongoSchema.Model.Room;
var db = mongoose.connection;

function removeTimeoutRooms () {
  var self = this;
  self.cleanFiles = [];
  async.auto({
    'init_db': function(callback) {
      db.on('error', function(er) {
        logger.error('connection error:', er);
        callback(er);
      });
      db.once('open', function () {
        logger.trace('MongoDB opened');
        callback();
      });
      mongoose.connect(globalConf['database']['connectionString']);
    },
    'find_old': ['init_db', function(callback) {
      RoomModel.find({
        $where: function() {
          if (!obj.checkoutTimestamp) {
            return false;
          };

          if (Date.now() - obj.checkoutTimestamp > 3600*1000*72) {
            return true;
          };
        }
      }, function(err, results) {
        if (err) {
          logger.error(err);
          callback(err);
        };
        if (results.dataFile) {
          self.cleanFiles.push(results.dataFile);
        };
        if (results.msgFile) {
          self.cleanFiles.push(results.msgFile);
        };
        callback();
      });
    }],
    'remove_old_from_db': ['find_old', function(callback) {
      RoomModel.remove({
        $where: function() {
          if (!obj.checkoutTimestamp) {
            return false;
          };

          if (Date.now() - obj.checkoutTimestamp > 3600*1000*72) {
            return true;
          };
        }
      }, function(err) {
        if (err) {
          logger.error(err);
          callback(err);
        }else{
          logger.trace('remove_old_from_db end');
          callback();
        }
      });
    }],
    'remove_old_from_disk': ['remove_old_from_db', function(callback) {
      async.map(self.cleanFiles, fs.unlink, function(err){
          if (err) {
            logger.error(err);
            callback(err);
          }else{
            logger.trace('remove_old_from_disk end');
            callback();
          }
      });
    }],
    'close_db': ['remove_old_from_disk', function(callback) {
      db.close(function(err) {
        if (err) {
          logger.error(err);
          callback(err);
        }else{
          // self = null;
          callback();
        }
      });
    }]
  }, function(err) {
    if (err) {
      logger.error(err);
    };
  });
  
}

removeTimeoutRooms();