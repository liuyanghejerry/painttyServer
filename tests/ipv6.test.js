var net = require('net');
var test = require('nodeunit');

exports['Test IPv6'] =  function(test) {
    test.expect(1);
    var server = new net.Server();

    server.listen(0, '::', function(err) {
        if (err) {
            // test.ok(!err, "ipv6 test failed!");
            console.log(err);
        };
        var addinfo = server.address();
        console.log(addinfo);
        test.ok(net.isIPv6(addinfo.address), "ipv6 test failed!");
        server.close();
        test.done();
    });
}

