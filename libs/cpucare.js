var util = require("util");
var events = require("events");
var usage = require('usage');

// simplified clone. Only designed for regular object
function clone(obj) {
  if (null == obj || "object" != typeof obj) return obj;
  var copy = obj.constructor();
  for (var attr in obj) {
    if (obj.hasOwnProperty(attr)) copy[attr] = clone(obj[attr]);
  }
  return copy;
}

function setDefault(obj, d) {
  for (var attr in d) {
    if (obj[attr] === undefined) {
      obj[attr] = clone(d[attr]);
    }
  }
}

var defaultOption = {
  cycle: 20*1000,
  target: process.pid,
  mark: 90,
  signal: 'SIGTERM'
};

function CpuCare(options) {
  events.EventEmitter.call(this);
  if (!options) {
    options = clone(defaultOption);
  }

  setDefault(options, defaultOption);

  var self = this;
  self.options = options;
  self.tid = setInterval(function () {
    self.checkUsage();
  }, options.cycle);
}

util.inherits(CpuCare, events.EventEmitter);

CpuCare.prototype.stop = function() {
  clearInterval(this.tid);

  if (usage.clearHistory) {
    usage.clearHistory(this.options.target);
  }
  this.destroy();
};

CpuCare.prototype.pause = function() {
  clearInterval(this.tid);
};

CpuCare.prototype.resume = function() {
  var options = this.options;
  this.tid = setInterval(function () {
    self.checkUsage();
  }, options.cycle);
};

CpuCare.prototype.destroy = function() {
  for (var attr in this.options) {
    if (this.options.hasOwnProperty(attr)) {
      this.options[attr] = null;
    }
  }
  this.options = null;
};

CpuCare.prototype.checkUsage = function() {
  var self = this;
  var op = self.options;
  // NOTE: keepHistory only works on Linux
  usage.lookup(op.target, { keepHistory: true }, function(err, result) {
    if (err) {
      console.log(err);
      return;
    }
    if (result.cpu >= op.mark) {
      process.kill(op.target, op.signal);
      setImmediate(function() {
        self.emit('processkilled', {
          cpu: result.cpu,
          memory: result.memory,
          mark: op.mark,
          signal: op.signal,
          cycle: op.cycle,
          pid: op.target
        });
        self.stop();
      });
    }
  });
}

module.exports = CpuCare;
