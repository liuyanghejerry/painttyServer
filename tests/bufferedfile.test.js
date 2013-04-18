var _ = require('underscore');
var BufferedFile = require('../bufferedfile.js');
var test = require('nodeunit');

exports['Test BufferedFile'] = function(test){
    
    test.expect(2);

    var bf = new BufferedFile({
                fileName: './bufferedfile.test.file',
                bufferSize: 1024,
                writeCycle: 0
            });
    var message = [
        {
            action: 'add',
            goods: 123
        },
        {
            action: 'sub',
            goods: 321
        }
    ];
    var jsonfile = new Buffer(JSON.stringify(message));
    for(var i=0;i<10000;++i) {
        bf.append(jsonfile);
    }
    
    bf.readAll(function(data) {
        test.ok(data.length == 10000*jsonfile.length, "BufferedFile test failed, missing data!");
        bf.clearAll(function() {
            bf.readAll(function(data) {
                test.ok(data.length == 0, "BufferedFile test failed, data remained after clearAll!");
                test.done();
            });
        });
    });
};
