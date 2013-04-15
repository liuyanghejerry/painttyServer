var _ = require('underscore');
var Router = require('../router.js');
var test = require('nodeunit');

exports['Test Router'] = function(test){
    test.expect(2);

    var ro_test = new Router();
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
    ro_test.reg('action', 'add', function(cli, msg) {
        test.ok(msg['goods'] == 123, "reg() in Router failed!");
    }).reg('action', 'sub', function(cli, msg) {
        test.ok(msg['goods'] == 321, "reg() in Router failed!");
        test.done();
    });

    _.each(message, function(ele) {
        ro_test.message(0, ele);
    });

    ro_test.clear();

    _.each(message, function(ele) {
        ro_test.message(0, ele);
    });    
};
