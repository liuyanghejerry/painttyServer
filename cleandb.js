var async = require('async');
var mongoose = require('mongoose');
var _ = require('underscore');
var fs = require('fs');
var MongoSchema = require('./schema.js');
var common = require('./common.js');
var logger = require('tracer').colorConsole(); // common.logger;
var globalConf = common.globalConf;

var RoomModel = MongoSchema.Model.Room;
var db = mongoose.connection;

function removeTimeoutRooms (lcb) {
  var self = this;
  self.cleanFiles = [];
  async.auto({
    'find_old': function(callback) {
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
    },
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
    }]
  }, function(err) {
    if (err) {
      logger.error(err);
      lcb(err);
    };
    lcb();
  });
  
}

function removeNoFileRooms(lcb) {
  var self = this;
  self.allFiles = [];
  self.cleanFiles = [];

  async.auto({
    'list_files': function(callback){
      RoomModel.find({}, 'dataFile msgFile', function(err, results) {
        if (err) {
          logger.error(err);
          callback(err);
          return;
        }else{
          _.each(results, function(ele) {
            self.allFiles.push(ele.dataFile);
            self.allFiles.push(ele.msgFile);
          });
          logger.trace('list_files end');
          callback();
        }
      });
    },
    'check_exists': ['list_files', function(callback){
      async.each(self.allFiles, function(item, cb){
        if(item){
          fs.exists(item, function(e) {
            if (!e) {
              self.cleanFiles.push(item);
            }
            cb();
          });
        }
      }, function(err) {
        if (err) {
          logger.error(err);
          callback(err);
          return;
        }
        logger.trace('check_exists end');
        callback();
      });
    }],
    'remove_from_db': ['check_exists', function(callback) {
      RoomModel.remove({$in: self.cleanFiles}, function(err){
        if (err) {
          logger.error(err);
          callback(err);
          return;
        }
        logger.trace('remove_from_db end');
        callback();
      });
    }]
  }, function(err){
    if (err) {
      logger.error(err);
      lcb(err);
      return;
    };
    lcb();
  });

}

function removeEmptyCloseRooms(lcb) {
  RoomModel.remove({"emptyclose": true}, function(err){
    if (err) {
      logger.error(err);
      lcb(err);
      return;
    }
    logger.trace('removeEmptyCloseRooms end');
    lcb();
  });
}

function insertLastCheckoutTime(lcb) {
  RoomModel.update(
    {"checkoutTimestamp": undefined}, 
    {"checkoutTimestamp": Date.now()}, 
    { multi: true },
    function(err){
      if (err) {
        logger.error(err);
        lcb(err);
        return;
      }
      logger.trace('insertLastCheckoutTime end');
      lcb();
  });
}

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
  'removeTimeoutRooms': ['init_db', function(callback) {
    removeTimeoutRooms(callback);
  }],
  'removeNoFileRooms': ['removeTimeoutRooms', function(callback) {
    removeNoFileRooms(callback);
  }],
  'removeEmptyCloseRooms': ['removeNoFileRooms', function(callback) {
    removeEmptyCloseRooms(callback)
  }],
  'insertLastCheckoutTime': ['removeEmptyCloseRooms', function(callback) {
    insertLastCheckoutTime(callback)
  }],
  'close_db': [
    'removeTimeoutRooms', 
    'removeNoFileRooms', 
    'removeEmptyCloseRooms', 
    'insertLastCheckoutTime', 
    function(callback) {
      db.close(function(err) {
        if (err) {
          logger.error(err);
          callback(err);
        }else{
          logger.trace('db closed');
          callback();
        }
      });
  }]
});

