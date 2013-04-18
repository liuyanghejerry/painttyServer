var os = require('os');
var events = require('events');
var fs = require('fs');
var util = require("util");
var Buffers = require('buffers');
var _ = require('underscore');
// var bw = require ("buffered-writer");
var logger = require('tracer').console();


function BufferedFile(options) {
    events.EventEmitter.call(this);
    
    var defaultOptions = {
        fileName: 'tmp.tmp',
        debug: false,
        writeCycle: 10*1000, // in milliseconds 
        bufferSize: 1024*1024 // in byte
    };
    
    if(_.isUndefined(options)) {
        var options = {};
    }
    
    var bf = this;
    this.op = _.defaults(options, defaultOptions);
    
    // fs.exists(bf.op.fileName, function (exists) {
      // if(!exists){
        
      // }
    // });
    if(bf.op.writeCycle != 0) {
        bf.timer = setInterval(function() {
            bf.writeToDisk();
        }, bf.op.writeCycle);
    }
    bf.buf = new Buffers();
    bf.writtenSize = 0;
}

util.inherits(BufferedFile, events.EventEmitter);

BufferedFile.prototype.writeToDisk = function (fn) {
    if(this.buf.length < 1){
        return;
    }
    // bw.open(this.op.fileName, {append: true})
    //     .on('error', function(err) {
    //         logger.log(err);
    //     })
    //     .write(this.buf.toBuffer())
    //     .close(function() {
    //         if( fn && _.isFunction(fn) ){
    //             return fn;
    //         }
    //     }());
    // DEBUG: use native function in node.js instead
    fs.appendFile(this.op.fileName, this.buf.toBuffer(), function(err) {
        if(err) logger.log(err);
        if( fn && _.isFunction(fn) ){
            return fn();
        }
    });
    this.buf = new Buffers();
    if(this.op.debug){
        logger.log('Write back!');
    }
};

BufferedFile.prototype.append = function (data, fn) {
    this.buf.push(new Buffer(data));
    if(this.buf.length >= this.op.bufferSize){
        this.writeToDisk(function() {
            if( fn && _.isFunction(fn) ){
                fn();
            }
        });
    }
    
};

BufferedFile.prototype.readAll = function (fn) {
    var bf = this;
    if(bf.buf.length > 0){
        bf.writeToDisk(function() {
            fs.exists(bf.op.fileName, function (exists) {
              if(exists){
                fs.readFile(bf.op.fileName, function (err, data) {
                  if (err){
                    logger.log(err);
                    return;
                  }
                  if( fn && _.isFunction(fn) ){
                    fn(data);
                  }
                });
              }
            });
        });
    }else{
        fs.exists(bf.op.fileName, function (exists) {
          if(exists){
            fs.readFile(bf.op.fileName, function (err, data) {
              if (err){
                logger.log(err);
                return;
              }
              if( fn && _.isFunction(fn) ){
                fn(data);
              }
            });
          }
        });
    }
};

BufferedFile.prototype.clearAll = function (fn) {
    var bf = this;
    if(bf.buf.length > 0){
        bf.buf = new Buffers();
    }
    fs.truncate(bf.op.fileName, 0, function() {});
};

module.exports = BufferedFile;